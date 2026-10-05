//! Normalize safe native items and operation phases before lifecycle reduction.
//! Explicit call/item aliases associate observations; source times are phase endpoints,
//! never the reconciled operation timestamp or a duration-derived position.
use super::{analysis::check, intervals};
use crate::session_events::{Event, Gap, ItemKind, LifecycleKind, Payload, Phase};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, atomic::AtomicBool},
};

pub(super) struct Observation<'a> {
    pub event: &'a Event,
    pub index: usize,
    pub identity: Option<String>,
    pub phase: &'a Phase,
    pub native_start: Option<i64>,
    pub native_end: Option<i64>,
    pub conflict: bool,
    /// Native MCP item completion establishes closure, not a successful outcome.
    pub outcome: Option<u8>,
    aliases: Vec<Alias<'a>>,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum Alias<'a> {
    Item(&'a str),
    Call(&'a str),
}
impl Alias<'_> {
    fn raw(&self) -> &str {
        match self {
            Self::Item(id) | Self::Call(id) => id,
        }
    }
    fn identity(self) -> String {
        match self {
            Self::Item(id) => serde_json::to_string(&("item", id)).expect("string identity"),
            Self::Call(id) => serde_json::to_string(&("call", id)).expect("string identity"),
        }
    }
}
fn category(kind: &ItemKind) -> Option<usize> {
    match kind {
        ItemKind::Command => Some(0),
        ItemKind::Compaction => Some(1),
        ItemKind::Reasoning => Some(2),
        ItemKind::Mcp => Some(3),
        _ => None,
    }
}
pub(super) fn category_at(index: usize) -> intervals::Category {
    [
        intervals::Category::Command,
        intervals::Category::Compaction,
        intervals::Category::Reasoning,
        intervals::Category::Mcp,
    ][index]
}
fn outcome(phase: &Phase) -> Option<u8> {
    match phase {
        Phase::Completed => Some(1),
        Phase::Failed => Some(2),
        Phase::Cancelled => Some(3),
        _ => None,
    }
}
fn observation(event: &Event) -> Option<Observation<'_>> {
    let (index, aliases, phase, native_start, native_end, outcome, operation_conflict) =
        match event.payload() {
            Payload::Item {
                item_kind,
                native_id,
                phase,
                started_at_ms,
                completed_at_ms,
                ..
            } => {
                let index = category(item_kind)?;
                (
                    index,
                    native_id.as_deref().into_iter().map(Alias::Item).collect(),
                    phase,
                    *started_at_ms,
                    *completed_at_ms,
                    if index == 3 && *phase == Phase::Completed {
                        None
                    } else {
                        outcome(phase)
                    },
                    false,
                )
            }
            Payload::Lifecycle {
                lifecycle: LifecycleKind::Compaction,
                native_id,
                phase,
                ..
            } => (
                1,
                native_id.as_deref().into_iter().map(Alias::Item).collect(),
                phase,
                None,
                None,
                outcome(phase),
                false,
            ),
            Payload::Operation { value, phase }
                if matches!(
                    value.kind.as_ref(),
                    "mcpTool" | "mcpResource" | "mcpDiscovery" | "mcpUnclassified" | "mcpConflict"
                ) =>
            {
                let aliases = [
                    value
                        .call_id
                        .as_deref()
                        .filter(|id| !id.is_empty())
                        .map(Alias::Call),
                    value
                        .item_id
                        .as_deref()
                        .filter(|id| !id.is_empty())
                        .map(Alias::Item),
                ]
                .into_iter()
                .flatten()
                .collect();
                (
                    3,
                    aliases,
                    phase,
                    None,
                    None,
                    outcome(phase),
                    value.kind.as_ref() == "mcpConflict" || value.outcome_conflict,
                )
            }
            _ => return None,
        };
    let conflict = operation_conflict
        || event
            .gaps()
            .iter()
            .any(|gap| matches!(gap, Gap::MissingIdentity | Gap::ConflictingIdentity));
    Some(Observation {
        event,
        index,
        identity: None,
        phase,
        native_start,
        native_end,
        conflict,
        outcome,
        aliases,
    })
}
pub(super) fn candidate_index(event: &Event) -> Option<usize> {
    observation(event).map(|observation| observation.index)
}
pub(super) fn is_candidate(event: &Event) -> bool {
    observation(event).is_some()
}

/// Inputs are already restricted to one source/thread/turn. Alias components are
/// reduced once, independent of event order; file generation stays with endpoints.
/// O(E log E) time and O(E) space, bounded by the caller's lifecycle-record budget.
pub(super) fn associate<'a>(
    events: &'a [Arc<Event>],
    cancelled: &AtomicBool,
) -> anyhow::Result<Vec<Observation<'a>>> {
    let mut observations = Vec::new();
    let mut aliases = BTreeMap::<Alias<'_>, BTreeSet<Alias<'_>>>::new();
    for event in events {
        check(cancelled)?;
        let Some(observation) = observation(event) else {
            continue;
        };
        for alias in &observation.aliases {
            aliases
                .entry(*alias)
                .or_default()
                .extend(observation.aliases.iter().copied());
        }
        observations.push(observation);
    }
    // The safe Item payload does not retain whether its native_id originated
    // from an item ID or a call-only native row. Only the same physical row can
    // bridge that ambiguity; matching text across rows is not association proof.
    let row = |event: &'a Event| {
        let position = event.position();
        (
            position.source_instance_id.as_str(),
            position.file_id.as_str(),
            position.generation.as_str(),
            position.byte_offset,
            event.thread_id(),
            event.turn_id(),
        )
    };
    let mut operation_rows = BTreeMap::<_, Vec<Alias<'a>>>::new();
    for observation in &observations {
        if matches!(observation.event.payload(), Payload::Operation { .. }) {
            operation_rows
                .entry(row(observation.event))
                .or_default()
                .extend(observation.aliases.iter().copied());
        }
    }
    for observation in &observations {
        check(cancelled)?;
        if !matches!(
            observation.event.payload(),
            Payload::Item {
                item_kind: ItemKind::Mcp,
                ..
            }
        ) {
            continue;
        }
        for native in &observation.aliases {
            for operation in operation_rows
                .get(&row(observation.event))
                .into_iter()
                .flatten()
                .filter(|operation| operation.raw() == native.raw())
            {
                aliases.entry(*native).or_default().insert(*operation);
                aliases.entry(*operation).or_default().insert(*native);
            }
        }
    }
    let mut identities = BTreeMap::<Alias<'_>, Alias<'_>>::new();
    for first in aliases.keys().copied() {
        check(cancelled)?;
        if identities.contains_key(&first) {
            continue;
        }
        let mut pending = vec![first];
        while let Some(alias) = pending.pop() {
            check(cancelled)?;
            if identities.insert(alias, first).is_some() {
                continue;
            }
            pending.extend(
                aliases[&alias]
                    .iter()
                    .copied()
                    .filter(|alias| !identities.contains_key(alias)),
            );
        }
    }
    for observation in &mut observations {
        observation.identity = observation
            .aliases
            .first()
            .map(|alias| identities[alias].identity());
    }
    // Raw safe phase payloads precede the adapter's operation merge. Retain its
    // explicit MCP dispatch contradictions without reading a flattened timestamp.
    #[derive(Default)]
    struct Dispatch<'a> {
        servers: BTreeSet<&'a str>,
        tools: BTreeSet<&'a str>,
        kinds: BTreeSet<&'a str>,
    }
    let mut targets = BTreeMap::<&str, Dispatch<'_>>::new();
    for observation in &observations {
        check(cancelled)?;
        let Some(identity) = observation.identity.as_deref() else {
            continue;
        };
        let Payload::Operation { value, .. } = observation.event.payload() else {
            continue;
        };
        let target = targets.entry(identity).or_default();
        if let Some(server) = value.server.as_deref() {
            target.servers.insert(server);
        }
        if let Some(tool) = value.tool.as_deref() {
            target.tools.insert(tool);
        }
        if value.kind.as_ref() != "mcpUnclassified" {
            target.kinds.insert(value.kind.as_ref());
        }
    }
    let conflicts = targets
        .into_iter()
        .filter_map(|(identity, target)| {
            (target.servers.len() > 1 || target.tools.len() > 1 || target.kinds.len() > 1)
                .then_some(identity.to_owned())
        })
        .collect::<BTreeSet<_>>();
    for observation in &mut observations {
        observation.conflict |= observation
            .identity
            .as_ref()
            .is_some_and(|identity| conflicts.contains(identity));
    }
    Ok(observations)
}
