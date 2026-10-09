//! Transient exact-request groups. No raw arguments, persistent findings or tool costs.
use super::*;

const FINDING_LIMIT: usize = 30;
type Key = (
    String,
    Option<String>,
    Option<String>,
    String,
    String,
    String,
);
#[derive(Default)]
struct Window {
    stats: ActivityStats,
    tasks: BTreeMap<String, (u64, u64)>,
    durations: Vec<u64>,
    first: Option<InspectionEvidence>,
    second_task: Option<InspectionEvidence>,
    failure: Option<InspectionEvidence>,
    rejection: Option<InspectionEvidence>,
    slowest: Option<InspectionEvidence>,
}
impl Window {
    fn add(&mut self, op: &Operation, proof: InspectionEvidence, p: &ActivityPolicy) {
        let outcomes = outcomes(op);
        self.stats.operations += 1;
        self.stats.determinate_operations += outcomes.determinate();
        self.stats.failed_operations += outcomes.failed;
        self.stats.rejected_operations += outcomes.rejected;
        self.stats.outcome_gaps += u64::from(outcomes.partial());
        let task = self.tasks.entry(proof.thread_id.clone()).or_default();
        task.0 += outcomes.failed;
        task.1 += outcomes.rejected;
        self.stats.maximum_failures_in_task = self.stats.maximum_failures_in_task.max(task.0);
        self.stats.maximum_rejections_in_task = self.stats.maximum_rejections_in_task.max(task.1);
        self.stats.tasks = self.tasks.len();
        if self.first.is_none() {
            self.first = Some(proof.clone());
        } else if self.second_task.is_none()
            && self
                .first
                .as_ref()
                .is_some_and(|p| p.thread_id != proof.thread_id)
        {
            self.second_task = Some(proof.clone());
        }
        if outcomes.failed > 0 && self.failure.is_none() {
            self.failure = Some(proof.clone());
        }
        if outcomes.rejected > 0 && self.rejection.is_none() {
            self.rejection = Some(proof.clone());
        }
        if let Some(ms) = terminal_duration(op, &outcomes) {
            self.durations.push(ms);
            self.stats.slow_operations += u64::from(ms >= p.slow_duration_ms);
            if self.stats.maximum_duration_ms.is_none_or(|max| ms > max) {
                self.stats.maximum_duration_ms = Some(ms);
                self.slowest = Some(proof);
            }
        }
    }
    fn finish(&mut self) {
        self.durations.sort_unstable();
        let n = self.durations.len();
        self.stats.duration_samples = n;
        self.stats.failure_share = (self.stats.determinate_operations > 0).then(|| {
            self.stats.failed_operations as f64 / self.stats.determinate_operations as f64
        });
        self.stats.median_duration_ms = (n > 0).then(|| {
            // Convert before adding: native durations can span the full u64 range.
            (self.durations[(n - 1) / 2] as f64 + self.durations[n / 2] as f64) / 2.0
        });
    }
    fn proofs(&self) -> Vec<InspectionEvidence> {
        let mut out = Vec::new();
        for proof in [
            &self.first,
            &self.second_task,
            &self.failure,
            &self.rejection,
            &self.slowest,
        ]
        .into_iter()
        .flatten()
        {
            if !out.iter().any(|p: &InspectionEvidence| {
                p.thread_id == proof.thread_id && p.operation_id == proof.operation_id
            }) {
                out.push(proof.clone());
            }
        }
        out
    }
}
#[derive(Default)]
struct Group {
    current: Window,
    baseline: Window,
}
fn outcomes(op: &Operation) -> crate::timing::work::Outcomes {
    inspection_outcomes(op)
}
fn terminal_duration(op: &Operation, out: &crate::timing::work::Outcomes) -> Option<u64> {
    (!out.partial() && out.determinate() + out.rejected + out.interrupted > 0)
        .then_some(op.duration_ms)
        .flatten()
}
fn key(thread: &crate::usage_store::ThreadEntry, op: &Operation) -> Option<Key> {
    let m = op.matching.as_ref()?;
    if m.receiver_owner.as_deref() != Some(thread.thread.id.as_str()) {
        return None;
    }
    let (basis, digest) = if let Some(digest) = &m.function_request_fingerprint {
        ("callable", digest)
    } else {
        ("command", m.request_fingerprint.as_ref()?)
    };
    Some((
        thread.thread.source_instance_id.clone(),
        thread.thread.project.clone(),
        // Unknown project identity cannot join requests from different tasks.
        thread
            .thread
            .project
            .is_none()
            .then(|| thread.thread.id.clone()),
        op.name.to_string(),
        basis.into(),
        digest.clone(),
    ))
}
pub(super) fn baseline_scope(scope: &Scope) -> Result<Option<Scope>> {
    if scope.all_time == Some(true) || scope.undated == Some(true) {
        return Ok(None);
    }
    let (Some(since), Some(until)) = (&scope.since, &scope.until) else {
        return Ok(None);
    };
    let a = date(since)?;
    let b = date(until)?;
    let mut baseline = scope.clone();
    baseline.since = Some(
        a.checked_sub_signed(Duration::days((b - a).num_days()))
            .ok_or_else(|| operation_error("INVALID_ARGUMENT", "历史比较日期超出范围"))?
            .to_string(),
    );
    baseline.until = Some(since.clone());
    Ok(Some(baseline))
}
fn signals(
    current: &ActivityStats,
    baseline: &ActivityStats,
    p: &ActivityPolicy,
) -> Vec<ActivitySignal> {
    let mut out = vec![];
    if current.slow_operations >= p.minimum_slow_operations {
        out.push(ActivitySignal::RepeatedSlowRequest);
    }
    if current.determinate_operations >= p.minimum_current_outcomes
        && baseline.determinate_operations >= p.minimum_baseline_outcomes
        && current.failed_operations >= p.minimum_spike_failures
    {
        let share = current.failed_operations as f64 / current.determinate_operations as f64;
        let base = baseline.failed_operations as f64 / baseline.determinate_operations as f64;
        if share >= p.minimum_failure_share
            && share >= p.failure_share_multiplier * base.max(p.baseline_failure_share_floor)
        {
            out.push(ActivitySignal::FailureSpike);
        }
    }
    if baseline.duration_samples >= p.minimum_baseline_durations
        && let Some(median) = baseline.median_duration_ms
        && median >= p.minimum_baseline_median_ms as f64
        && let Some(max) = current.maximum_duration_ms
        && max >= p.slow_duration_ms
        && max as f64 >= median * p.duration_multiplier
        && max as f64 - median >= p.minimum_duration_increase_ms as f64
    {
        out.push(ActivitySignal::DurationSpike);
    }
    if current.operations >= p.minimum_workflow_operations
        && current.tasks >= p.minimum_workflow_tasks
    {
        out.push(ActivitySignal::RecurringWorkflow);
    }
    if current.maximum_failures_in_task >= p.minimum_failures_in_task {
        out.push(ActivitySignal::RepeatedFailure);
    }
    if current.maximum_rejections_in_task >= p.minimum_rejections_in_task {
        out.push(ActivitySignal::RepeatedRejection);
    }
    out
}
pub(super) struct Builder {
    groups: BTreeMap<Key, Group>,
    pub baseline_scope: Option<Scope>,
    policy: ActivityPolicy,
    current: ActivityCoverage,
    baseline: ActivityCoverage,
}
impl Builder {
    pub(super) fn new(scope: &Scope) -> Result<Self> {
        let empty = || ActivityCoverage {
            observed_operations: 0,
            matched_operations: 0,
            outcome_gaps: 0,
            duration_samples: 0,
        };
        Ok(Self {
            groups: BTreeMap::new(),
            baseline_scope: baseline_scope(scope)?,
            policy: ActivityPolicy::default(),
            current: empty(),
            baseline: empty(),
        })
    }
    pub(super) fn add(
        &mut self,
        s: &Snapshot,
        scope: &Scope,
        thread: &crate::usage_store::ThreadEntry,
        op: &Operation,
        baseline: bool,
    ) {
        let coverage = if baseline {
            &mut self.baseline
        } else {
            &mut self.current
        };
        coverage.observed_operations += 1;
        let out = outcomes(op);
        coverage.outcome_gaps += u64::from(out.partial());
        coverage.duration_samples += u64::from(terminal_duration(op, &out).is_some());
        let Some(key) = key(thread, op) else {
            return;
        };
        coverage.matched_operations += 1;
        let group = self.groups.entry(key).or_default();
        let window = if baseline {
            &mut group.baseline
        } else {
            &mut group.current
        };
        window.add(
            op,
            evidence(
                s,
                scope,
                &thread.thread.id,
                op.turn_id.as_deref(),
                Some(&op.id),
            ),
            &self.policy,
        );
    }
    pub(super) fn finish(self) -> ActivityReview {
        let mut groups: Vec<_> = self.groups.into_iter().collect();
        groups.sort_by(|(a, x), (b, y)| {
            y.current
                .stats
                .operations
                .cmp(&x.current.stats.operations)
                .then(a.cmp(b))
        });
        let mut findings = vec![];
        let mut finding_count = 0;
        for (key, mut group) in groups {
            group.current.finish();
            group.baseline.finish();
            let signals = signals(&group.current.stats, &group.baseline.stats, &self.policy);
            if signals.is_empty() {
                continue;
            }
            finding_count += 1;
            if findings.len() < FINDING_LIMIT {
                findings.push(ActivityFinding {
                    id: crate::hash(serde_json::to_vec(&("activity_request_v1", &key)).unwrap()),
                    signals,
                    source_instance_id: key.0,
                    project: key.1,
                    tool: key.3,
                    current: group.current.stats.clone(),
                    baseline: self
                        .baseline_scope
                        .as_ref()
                        .map(|_| group.baseline.stats.clone()),
                    evidence: group.current.proofs(),
                    baseline_evidence: group.baseline.proofs(),
                });
            }
        }
        ActivityReview {
            method_version: 1,
            policy: self.policy,
            baseline_scope: self.baseline_scope.clone(),
            current_coverage: self.current,
            baseline_coverage: self.baseline_scope.map(|_| self.baseline),
            findings,
            finding_count,
            limit: FINDING_LIMIT,
        }
    }
}

#[cfg(test)]
mod tests;
