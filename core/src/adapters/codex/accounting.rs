//! Direct and cumulative accounting reconciliation preserves missing and conflicting facts.
use super::*;
impl Facts {
    pub(super) fn measurement(
        &mut self,
        mut candidate: Candidate,
        context_conflicts: &[crate::session_events::MeasurementContextField],
        report: &mut SourceReport,
    ) {
        self.strings
            .measurement(Arc::make_mut(&mut candidate.measurement));
        timing::measurement(self, &candidate, context_conflicts, report);
    }
    pub(super) fn project_measurement(&mut self, candidate: Candidate, report: &mut SourceReport) {
        self.dirty_measurements
            .insert(candidate.measurement.id.clone());
        if let Some(existing) = self.measurements.get_mut(&candidate.measurement.id) {
            existing.direct |= candidate.direct;
            existing.cumulative = existing.cumulative.or(candidate.cumulative);
            existing.interval_start = existing.interval_start.or(candidate.interval_start);
            let incoming = Arc::unwrap_or_clone(candidate.measurement);
            let old = Arc::make_mut(&mut existing.measurement);
            let prefix = old.id.clone();
            let conflicts = &mut self.measurement_conflicts;
            let mut token_conflict = false;
            for (field, current, new) in [
                ("input", &mut old.tokens.input, &incoming.tokens.input),
                (
                    "cacheRead",
                    &mut old.tokens.cache_read,
                    &incoming.tokens.cache_read,
                ),
                (
                    "cacheCreate",
                    &mut old.tokens.cache_create,
                    &incoming.tokens.cache_create,
                ),
                ("output", &mut old.tokens.output, &incoming.tokens.output),
                (
                    "reasoning",
                    &mut old.tokens.reasoning,
                    &incoming.tokens.reasoning,
                ),
                ("total", &mut old.tokens.total, &incoming.tokens.total),
                (
                    "rawInput",
                    &mut old.tokens.raw_input,
                    &incoming.tokens.raw_input,
                ),
            ] {
                token_conflict |=
                    merge_optional(current, new, conflicts, &format!("{prefix}:{field}"));
            }
            if token_conflict {
                issue(
                    report,
                    "measurementConflict",
                    "同一用量身份出现不同计数",
                    incoming.evidence.first().cloned(),
                );
            }
            if merge_optional(
                &mut old.turn_id,
                &incoming.turn_id,
                conflicts,
                &format!("{prefix}:turn"),
            ) {
                issue(
                    report,
                    "ownershipConflict",
                    "同一用量的轮次归属冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            let mut model_conflict = merge_optional(
                &mut old.model.raw,
                &incoming.model.raw,
                conflicts,
                &format!("{prefix}:model"),
            );
            model_conflict |= merge_optional(
                &mut old.model.provider,
                &incoming.model.provider,
                conflicts,
                &format!("{prefix}:provider"),
            );
            model_conflict |= merge_optional(
                &mut old.model.api_provider,
                &incoming.model.api_provider,
                conflicts,
                &format!("{prefix}:apiProvider"),
            );
            old.pricing_context_conflict |= incoming.pricing_context_conflict || model_conflict;
            if model_conflict {
                issue(
                    report,
                    "modelConflict",
                    "同一用量的模型冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            if merge_optional(
                &mut old.reasoning_effort,
                &incoming.reasoning_effort,
                conflicts,
                &format!("{prefix}:effort"),
            ) {
                issue(
                    report,
                    "contextConflict",
                    "同一用量的推理强度冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            if candidate.direct {
                old.request_scoped = true;
                old.grain = "response".into();
            }
            if incoming
                .timestamp
                .as_ref()
                .is_some_and(|new| old.timestamp.as_ref().is_none_or(|current| new < current))
            {
                old.timestamp = incoming.timestamp;
                old.time_precision = incoming.time_precision;
            }
            for evidence in incoming.evidence {
                if !old.evidence.contains(&evidence) {
                    old.evidence.push(evidence);
                }
            }
        } else {
            self.measurements
                .insert(candidate.measurement.id.clone(), candidate);
        }
    }
    pub(super) fn remove_inherited(&mut self, forest: &ancestry::ForkForest<'_>) {
        // Only byte-identical native counter events can be inherited. Direct response
        // records retain their explicit owner, even when their counts match an ancestor.
        let remove: Vec<_> = forest
            .replays(self.measurements.iter().filter_map(|(id, candidate)| {
                Some((
                    candidate.fingerprint.as_str(),
                    candidate.measurement.thread_id.as_deref()?,
                    id.as_str(),
                ))
            }))
            .into_iter()
            .filter(|(id, _)| !self.measurements[*id].direct)
            .map(|(id, _)| id.to_owned())
            .collect();
        for id in remove {
            self.measurements.remove(&id);
        }
    }
    pub(super) fn reconcile_direct(&mut self, report: &mut SourceReport) {
        if self.measurements.values().all(|candidate| candidate.direct) {
            return;
        }
        // Build coverage once per owner. Scanning every direct response for every
        // legacy counter is quadratic across unrelated historical conversations.
        let mut direct = BTreeMap::<Arc<str>, Vec<(u64, u64)>>::new();
        let mut unbounded = BTreeMap::<Option<Arc<str>>, BTreeSet<Option<Arc<str>>>>::new();
        for candidate in self.measurements.values().filter(|v| v.direct) {
            if let (Some(thread), Some(start), Some(end)) = (
                &candidate.measurement.thread_id,
                candidate.interval_start,
                candidate.cumulative,
            ) {
                direct.entry(thread.clone()).or_default().push((start, end));
            }
            if candidate.interval_start.is_none() || candidate.cumulative.is_none() {
                unbounded
                    .entry(candidate.measurement.thread_id.clone())
                    .or_default()
                    .insert(candidate.measurement.turn_id.clone());
            }
        }
        for ranges in direct.values_mut() {
            ranges.sort_unstable();
            let mut merged: Vec<(u64, u64)> = Vec::new();
            for &(start, end) in ranges.iter() {
                if let Some(last) = merged.last_mut()
                    && start <= last.1
                {
                    last.1 = last.1.max(end);
                } else {
                    merged.push((start, end));
                }
            }
            *ranges = merged;
        }
        let mut remove = Vec::new();
        for (id, candidate) in &self.measurements {
            if candidate.direct {
                continue;
            }
            if unbounded
                .get(&candidate.measurement.thread_id)
                .is_some_and(|turns| {
                    candidate.measurement.turn_id.is_none()
                        || turns.contains(&None)
                        || turns.contains(&candidate.measurement.turn_id)
                })
            {
                issue(
                    report,
                    "usageCoverageUnknown",
                    "同轮存在逐响应用量，未叠加缺少覆盖依据的旧累计记录",
                    candidate.measurement.evidence.first().cloned(),
                );
                remove.push(id.clone());
                continue;
            }
            let (Some(thread), Some(start), Some(end)) = (
                &candidate.measurement.thread_id,
                candidate.interval_start,
                candidate.cumulative,
            ) else {
                continue;
            };
            let ranges = direct.get(thread).map(Vec::as_slice).unwrap_or_default();
            let next = ranges.get(ranges.partition_point(|(_, to)| *to <= start));
            let overlaps = next.is_some_and(|(from, _)| *from < end);
            if next.is_some_and(|(from, to)| *from <= start && *to >= end) && end > start {
                remove.push(id.clone());
            } else if overlaps {
                issue(
                    report,
                    "usageOverlap",
                    "逐响应记录与累计区间部分重叠；该累计记录未重复计入",
                    candidate.measurement.evidence.first().cloned(),
                );
                remove.push(id.clone());
            }
        }
        for id in remove {
            self.measurements.remove(&id);
        }
    }
}
