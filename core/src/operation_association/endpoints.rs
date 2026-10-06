//! Endpoint observations for already associated operations. Durations never create anchors.
//! Callers bound observations before reduction and choose their own eligible kinds.
use super::{BridgeKind, ObservationKind, ResolvedPhase, Scope, bridge_kind, check};
use crate::session_events::{ItemKind, Phase};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::atomic::AtomicBool,
};

pub(crate) const METHOD_VERSION: u32 = 1;
#[derive(Default)]
struct Domain {
    starts: BTreeSet<i64>,
    ends: BTreeSet<i64>,
    native_starts: BTreeSet<i64>,
    native_ends: BTreeSet<i64>,
    closed: bool,
    start_ref: Option<String>,
    end_ref: Option<String>,
    native_start_ref: Option<String>,
    native_end_ref: Option<String>,
    terminal_ref: Option<String>,
}
struct Group<'a> {
    scope: Scope<'a>,
    indices: Vec<usize>,
    domains: BTreeMap<(&'a str, &'a str), Domain>,
    identity_conflict: bool,
    kinds: BTreeSet<u8>,
}
pub(crate) struct EndpointGroup<'a> {
    pub scope: Scope<'a>,
    pub identity: String,
    pub indices: Vec<usize>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub evidence_ids: Vec<String>,
    pub identity_conflict: bool,
    pub time_conflict: bool,
    pub kind_conflict: bool,
    pub unmatched_clock_domain: bool,
}
pub(crate) struct Endpoints<'a> {
    pub method_version: u32,
    pub groups: Vec<EndpointGroup<'a>>,
    pub missing_identity: Vec<usize>,
    pub missing_time: Vec<usize>,
}
// Generic tool observations can refine to a native command/file/MCP kind.
// Distinct explicit kinds cannot borrow each other's endpoints.
fn kind(kind: ObservationKind<'_>) -> Option<u8> {
    match kind {
        ObservationKind::Item(kind) => match kind {
            ItemKind::Command => Some(1),
            ItemKind::File => Some(2),
            ItemKind::Mcp => Some(3),
            ItemKind::Reasoning => Some(4),
            ItemKind::Compaction => Some(5),
            ItemKind::Assistant => Some(6),
            ItemKind::User => Some(7),
            ItemKind::Tool => None,
        },
        ObservationKind::Compaction => Some(5),
        ObservationKind::Operation(operation) => bridge_kind(operation).map(|kind| match kind {
            BridgeKind::Command => 1,
            BridgeKind::File => 2,
            BridgeKind::Mcp => 3,
        }),
    }
}
fn singleton(values: &BTreeSet<i64>) -> Option<i64> {
    (values.len() == 1).then(|| *values.first().unwrap())
}
fn pair(domain: &Domain, native_start: bool, native_end: bool) -> Option<(i64, i64)> {
    domain
        .closed
        .then(|| {
            singleton(if native_start {
                &domain.native_starts
            } else {
                &domain.starts
            })
            .zip(singleton(if native_end {
                &domain.native_ends
            } else {
                &domain.ends
            }))
        })
        .flatten()
}
/// Canonical identity precedes endpoints; a pair requires one closed same-file generation.
/// Native anchors have priority over envelope times globally within that identity. Conflicts
/// are never resolved by choosing the first/last value. O(n log n) time and O(n) space.
pub(crate) fn reduce<'a>(
    phases: &[ResolvedPhase<'a>],
    cancelled: &AtomicBool,
) -> anyhow::Result<Endpoints<'a>> {
    let mut result = Endpoints {
        method_version: METHOD_VERSION,
        groups: vec![],
        missing_identity: vec![],
        missing_time: vec![],
    };
    let mut groups: BTreeMap<(Scope<'a>, &str), Group<'a>> = BTreeMap::new();
    for (index, phase) in phases.iter().enumerate() {
        check(cancelled)?;
        let Some(id) = phase.identity.as_deref() else {
            result.missing_identity.push(index);
            continue;
        };
        let event = phase.event;
        let scope = Scope::event(event);
        let position = event.position();
        let group = groups.entry((scope, id)).or_insert_with(|| Group {
            scope,
            indices: vec![],
            domains: BTreeMap::new(),
            identity_conflict: false,
            kinds: BTreeSet::new(),
        });
        group.indices.push(index);
        group.identity_conflict |= phase.identity_conflict;
        if let Some(kind) = kind(phase.kind) {
            group.kinds.insert(kind);
        }
        let domain = group
            .domains
            .entry((&position.file_id, &position.generation))
            .or_default();
        let terminal = matches!(
            phase.phase,
            Phase::Completed | Phase::Failed | Phase::Cancelled
        );
        domain.closed |= terminal;
        if terminal {
            domain
                .terminal_ref
                .get_or_insert_with(|| event.id().to_owned());
        }
        if let Some(time) = phase.native_start {
            domain.native_starts.insert(time);
            domain
                .native_start_ref
                .get_or_insert_with(|| event.id().to_owned());
        }
        if let Some(time) = phase.native_end {
            domain.native_ends.insert(time);
            domain
                .native_end_ref
                .get_or_insert_with(|| event.id().to_owned());
        }
        let timestamp = event
            .time()
            .timestamp
            .as_deref()
            .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
            .map(|time| time.timestamp_millis());
        let start = (*phase.phase == Phase::Started)
            .then_some(timestamp)
            .flatten();
        let end = terminal.then_some(timestamp).flatten();
        if let Some(time) = start {
            domain.starts.insert(time);
            domain
                .start_ref
                .get_or_insert_with(|| event.id().to_owned());
        }
        if let Some(time) = end {
            domain.ends.insert(time);
            domain.end_ref.get_or_insert_with(|| event.id().to_owned());
        }
        if start.is_none()
            && end.is_none()
            && phase.native_start.is_none()
            && phase.native_end.is_none()
        {
            result.missing_time.push(index);
        }
    }
    for ((_scope, id), group) in groups {
        check(cancelled)?;
        let native_start = group
            .domains
            .values()
            .any(|domain| !domain.native_starts.is_empty());
        let native_end = group
            .domains
            .values()
            .any(|domain| !domain.native_ends.is_empty());
        let mut starts = BTreeSet::<i64>::new();
        let mut ends = BTreeSet::<i64>::new();
        let mut pairs = BTreeSet::new();
        for domain in group.domains.values() {
            check(cancelled)?;
            starts.extend(if native_start {
                &domain.native_starts
            } else {
                &domain.starts
            });
            ends.extend(if native_end {
                &domain.native_ends
            } else {
                &domain.ends
            });
            if let Some(pair) = pair(domain, native_start, native_end) {
                pairs.insert(pair);
            }
        }
        let unique_pair = (pairs.len() == 1).then(|| *pairs.first().unwrap());
        let mut evidence_ids = vec![];
        if let Some(selected) = unique_pair {
            for domain in group.domains.values() {
                check(cancelled)?;
                if pair(domain, native_start, native_end) != Some(selected) {
                    continue;
                }
                for id in [
                    if native_start {
                        &domain.native_start_ref
                    } else {
                        &domain.start_ref
                    },
                    if native_end {
                        &domain.native_end_ref
                    } else {
                        &domain.end_ref
                    },
                    &domain.terminal_ref,
                ]
                .into_iter()
                .flatten()
                {
                    if !evidence_ids.contains(id) {
                        evidence_ids.push(id.clone());
                    }
                }
                break;
            }
        }
        result.groups.push(EndpointGroup {
            scope: group.scope,
            identity: id.to_owned(),
            indices: group.indices,
            start_ms: singleton(&starts),
            end_ms: unique_pair.map(|(_, end)| end),
            evidence_ids,
            identity_conflict: group.identity_conflict,
            time_conflict: starts.len() > 1 || ends.len() > 1,
            kind_conflict: group.kinds.len() > 1,
            unmatched_clock_domain: group.domains.len() > 1
                && !starts.is_empty()
                && !ends.is_empty()
                && pairs.is_empty(),
        });
    }
    check(cancelled)?;
    Ok(result)
}
