//! Physical and native identities, thread/turn facts and operation attribution.
use super::*;
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Facts {
    pub(super) watermarks: BTreeMap<String, SourceWatermark>,
    #[serde(skip)]
    pub(super) strings: super::super::shared_strings::FactStrings,
    #[serde(skip)]
    pub(super) event_strings: crate::session_events::EventStrings,
    pub(super) threads: BTreeMap<String, Thread>,
    pub(super) turns: BTreeMap<String, Turn>,
    pub(super) measurements: BTreeMap<String, Candidate>,
    pub(super) operations: BTreeMap<String, Arc<Operation>>,
    #[serde(skip)]
    pub(super) event_context: Option<timing::Context>,
    pub(super) title_observations:
        BTreeMap<String, crate::session_events::title_observations::TitleObservation>,
    #[serde(skip)]
    pub(super) retained_collection_times: BTreeMap<String, String>,
    pub(super) events: BTreeMap<String, Arc<crate::session_events::Event>>,
    #[serde(skip)]
    pub(super) dirty_events: BTreeSet<String>,
    #[serde(skip)]
    pub(super) dirty_operations: BTreeSet<String>,
    #[serde(skip)]
    pub(super) operations_pending: bool,
    #[serde(skip)]
    pub(super) retired_operations: BTreeSet<String>,
    #[serde(skip)]
    pub(super) operation_aliases: BTreeMap<String, Arc<[crate::operation_association::OwnedAlias]>>,
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
            title_observations: self.title_observations.clone(),
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
            operation_aliases: if include_facts {
                self.operation_aliases.clone()
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
        let id = thread_identity(source_id, upstream);
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
        let id = turn_identity(thread, upstream);
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
    pub(super) fn project_operation(&mut self, operation: Operation, _report: &mut SourceReport) {
        self.observe_operation(&operation);
        self.operations_pending = true;
    }
    /// Rebuild the affected source's association once; retain unchanged allocations
    /// and emit ordinary append deltas. Retired identities require atomic replacement.
    pub(super) fn resolve_operations(
        &mut self,
        report: &mut SourceReport,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> anyhow::Result<()> {
        let check = crate::operation_association::check;
        check(cancelled)?;
        if !self.operations_pending {
            return Ok(());
        }
        let resolution = crate::operation_association::resolve(
            self.events.values().map(AsRef::as_ref),
            cancelled,
        )?;
        let mut operations = BTreeMap::new();
        let mut aliases = HashMap::new();
        let mut operation_aliases = BTreeMap::new();
        for group in resolution.groups {
            crate::operation_association::check(cancelled)?;
            let mut observed = group.operation_events.into_iter();
            let Some(first) = observed.next() else {
                continue;
            };
            let crate::session_events::Payload::Operation { value, .. } = first.payload() else {
                unreachable!()
            };
            let mut operation = value.as_ref().clone();
            operation.id.clone_from(&group.id);
            for event in observed {
                crate::operation_association::check(cancelled)?;
                let crate::session_events::Payload::Operation { value, .. } = event.payload()
                else {
                    unreachable!()
                };
                let mut incoming = value.as_ref().clone();
                operations::merge_metadata(&mut operation, &mut incoming, report);
                for evidence in incoming.evidence {
                    check(cancelled)?;
                    operation.evidence.push(evidence);
                }
            }
            // Identity/phase association owns these contradictions. A missing field
            // does not contradict a recorded target; merged metadata cannot refill it.
            if group.target_conflict {
                operation.kind = "mcpConflict".into();
                operation.server = None;
                operation.tool = None;
                issue(
                    report,
                    "operationIdentityConflict",
                    "同一 MCP 调用的来源身份冲突",
                    operation.evidence.first().cloned(),
                );
            }
            if group.outcome_conflict {
                operation.outcome_conflict = true;
                operation.exit_code = None;
            }
            crate::operation_association::check(cancelled)?;
            operation
                .evidence
                .sort_unstable_by(|a, b| (&a.file, a.line).cmp(&(&b.file, b.line)));
            check(cancelled)?;
            operation.evidence.dedup();
            check(cancelled)?;
            self.strings.operation(&mut operation);
            let retained = self
                .operations
                .get(&group.id)
                .filter(|old| old.as_ref() == &operation)
                .cloned();
            let row = if let Some(retained) = retained {
                retained
            } else {
                self.dirty_operations.insert(group.id.clone());
                Arc::new(operation)
            };
            operations.insert(group.id.clone(), row);
            let mut owned_aliases = Vec::new();
            for alias in group.aliases {
                crate::operation_association::check(cancelled)?;
                owned_aliases.push(alias.owned());
                let (namespace, native) = match alias {
                    crate::operation_association::Alias::Call(value) => ("call", value),
                    crate::operation_association::Alias::Item(value) => ("item", value),
                };
                let key = stable_id(&[
                    group.scope.source,
                    group.scope.thread.unwrap_or(""),
                    group.scope.turn.unwrap_or(""),
                    namespace,
                    native,
                ]);
                if self.aliases.get(&key) != Some(&group.id) {
                    self.dirty_aliases.insert(key.clone());
                }
                aliases.insert(key, group.id.clone());
            }
            operation_aliases.insert(group.id.clone(), Arc::from(owned_aliases));
        }
        for id in self.operations.keys() {
            check(cancelled)?;
            if !operations.contains_key(id) {
                self.retired_operations.insert(id.clone());
            }
        }
        for id in std::mem::take(&mut self.dirty_operations) {
            check(cancelled)?;
            if operations.contains_key(&id) {
                self.dirty_operations.insert(id);
            }
        }
        check(cancelled)?;
        self.operations = operations;
        self.aliases = aliases;
        self.operation_aliases = operation_aliases;
        self.operations_pending = false;
        Ok(())
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
