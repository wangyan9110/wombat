//! Physical and native identities, thread/turn facts and operation attribution.
use super::*;
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Facts {
    pub(super) watermarks: BTreeMap<String, SourceWatermark>,
    #[serde(skip)]
    pub(super) strings: super::super::shared_strings::FactStrings,
    pub(super) threads: BTreeMap<String, Thread>,
    pub(super) turns: BTreeMap<String, Turn>,
    pub(super) measurements: BTreeMap<String, Candidate>,
    pub(super) operations: BTreeMap<String, Arc<Operation>>,
    #[serde(skip)]
    pub(super) event_context: Option<timing::Context>,
    pub(super) events: BTreeMap<String, Arc<crate::session_events::Event>>,
    #[serde(skip)]
    pub(super) dirty_events: BTreeSet<String>,
    #[serde(skip)]
    pub(super) dirty_operations: BTreeSet<String>,
    #[serde(skip)]
    pub(super) dirty_measurements: BTreeSet<String>,
    #[serde(skip)]
    pub(super) dirty_aliases: BTreeSet<String>,
    pub(super) aliases: HashMap<String, String>,
    pub(super) parents: HashMap<String, String>,
    pub(super) measurement_conflicts: BTreeSet<String>,
    pub(super) projects: BTreeMap<String, BTreeSet<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Candidate {
    pub(super) measurement: Arc<Measurement>,
    pub(super) direct: bool,
    pub(super) cumulative: Option<u64>,
    pub(super) interval_start: Option<u64>,
    pub(super) fingerprint: String,
}

impl Facts {
    pub(super) fn fork_derived(&self, include_facts: bool) -> Self {
        Self {
            watermarks: self.watermarks.clone(),
            events: self.events.clone(),
            threads: self.threads.clone(),
            turns: self.turns.clone(),
            measurements: if include_facts {
                self.measurements.clone()
            } else {
                BTreeMap::new()
            },
            operations: if include_facts {
                self.operations.clone()
            } else {
                BTreeMap::new()
            },
            parents: self.parents.clone(),
            measurement_conflicts: self.measurement_conflicts.clone(),
            projects: self.projects.clone(),
            ..Self::default()
        }
    }
    pub(super) fn project_thread(
        &mut self,
        source_id: &str,
        upstream: &str,
        timestamp: Option<&str>,
        cwd: Option<&str>,
    ) -> String {
        let id = stable_id(&["codex", source_id, "thread", upstream]);
        if let Some(cwd) = cwd {
            self.projects
                .entry(id.clone())
                .or_default()
                .insert(cwd.into());
        }
        let thread = self.threads.entry(id.clone()).or_insert_with(|| Thread {
            id: id.clone(),
            agent_kind: "codex".into(),
            source_instance_id: source_id.into(),
            upstream_id: upstream.into(),
            title: None,
            project: cwd.map(safe_text),
            started_at: timestamp.map(str::to_owned),
            last_activity_at: timestamp.map(str::to_owned),
        });
        if let Some(time) = timestamp {
            if thread.started_at.as_deref().is_none_or(|old| old > time) {
                thread.started_at = Some(time.into());
            }
            if thread
                .last_activity_at
                .as_deref()
                .is_none_or(|old| old < time)
            {
                thread.last_activity_at = Some(time.into());
            }
        }
        if thread.project.is_none() {
            thread.project = cwd.map(safe_text);
        }
        id
    }
    pub(super) fn project_turn(
        &mut self,
        thread: &str,
        upstream: &str,
        timestamp: Option<&str>,
        status: Option<&str>,
    ) -> String {
        let id = stable_id(&[thread, "turn", upstream]);
        let turn = self.turns.entry(id.clone()).or_insert_with(|| Turn {
            id: id.clone(),
            thread_id: thread.into(),
            upstream_id: upstream.into(),
            ordinal: 0,
            started_at: timestamp.map(str::to_owned),
            ended_at: None,
            last_activity_at: timestamp.map(str::to_owned),
            status: "unknown".into(),
        });
        if let Some(time) = timestamp
            && turn.started_at.as_deref().is_none_or(|old| old > time)
        {
            turn.started_at = Some(time.into());
        }
        if let Some(time) = timestamp
            && turn
                .last_activity_at
                .as_deref()
                .is_none_or(|old| old < time)
        {
            turn.last_activity_at = Some(time.into());
        }
        if let Some(status) = status {
            if status != "running" || turn.status == "unknown" {
                turn.status = status.into();
            }
            if matches!(status, "completed" | "interrupted" | "failed") {
                turn.ended_at = timestamp.map(str::to_owned);
            }
        }
        id
    }
    pub(super) fn operation(&mut self, mut operation: Operation, report: &mut SourceReport) {
        self.strings.operation(&mut operation);
        timing::operation(self, &operation, report);
    }
    pub(super) fn project_operation(
        &mut self,
        mut operation: Operation,
        report: &mut SourceReport,
    ) {
        self.observe_operation(&operation);
        let aliases: Vec<_> = [operation.call_id.as_deref(), operation.item_id.as_deref()]
            .into_iter()
            .flatten()
            .map(|id| {
                operations::operation_id(&operation.thread_id, operation.turn_id.as_deref(), id)
            })
            .collect();
        if let Some(id) = aliases
            .iter()
            .find_map(|key| {
                self.aliases
                    .get(key)
                    .or_else(|| self.operations.get_key_value(key).map(|(id, _)| id))
            })
            .cloned()
        {
            operation.id = id;
        }
        for alias in aliases {
            // Canonical operations already index their own identity. Persist only alternate IDs.
            if alias != operation.id {
                self.dirty_aliases.insert(alias.clone());
                self.aliases.insert(alias, operation.id.clone());
            }
        }
        self.dirty_operations.insert(operation.id.clone());
        if let Some(old) = self.operations.get_mut(&operation.id) {
            let old = Arc::make_mut(old);
            operations::merge_metadata(old, &mut operation, report);
            for evidence in operation.evidence {
                if !old.evidence.contains(&evidence) {
                    old.evidence.push(evidence);
                }
            }
        } else {
            self.operations
                .insert(operation.id.clone(), Arc::new(operation));
        }
    }
    pub(super) fn observe_operation(&mut self, operation: &Operation) {
        if let Some(turn) = operation
            .turn_id
            .as_ref()
            .and_then(|id| self.turns.get_mut(id.as_ref()))
            && let Some(time) = &operation.timestamp
            && turn.last_activity_at.as_ref().is_none_or(|old| old < time)
        {
            turn.last_activity_at = Some(time.clone());
        }
    }
}
pub(super) fn merge_optional<T: Clone + Eq>(
    current: &mut Option<T>,
    new: &Option<T>,
    conflicts: &mut BTreeSet<String>,
    key: &str,
) -> bool {
    if conflicts.contains(key) {
        *current = None;
        return false;
    }
    if current
        .as_ref()
        .zip(new.as_ref())
        .is_some_and(|(a, b)| a != b)
    {
        *current = None;
        conflicts.insert(key.into());
        return true;
    }
    if current.is_none() {
        *current = new.clone();
    }
    false
}
