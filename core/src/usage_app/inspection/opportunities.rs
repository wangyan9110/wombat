//! Independent checks over the existing ledger, canonical operations and safe observations.
use super::*;
use crate::session_events::{Event, ReviewObservation as R, SafetyLabel as L};
use OpportunityGap as G;
use OpportunityMetricName as M;
use OpportunityRule as Rule;
use OpportunityUnit as U;
mod cost;
mod runtime;
const LIMIT: usize = 3;
const RULES: [Rule; 17] = [
    Rule::UnpricedUsage,
    Rule::EstimateConcentration,
    Rule::EstimateOutlier,
    Rule::EstimateIncrease,
    Rule::CacheCreationReuse,
    Rule::ModelReview,
    Rule::SensitiveRead,
    Rule::SensitiveChange,
    Rule::OutsideProjectChange,
    Rule::RiskyCommand,
    Rule::SecretExposure,
    Rule::SensitiveOutbound,
    Rule::RepeatedRiskyDecline,
    Rule::PermissionFriction,
    Rule::UnansweredQuestion,
    Rule::LongInteraction,
    Rule::FrequentPolling,
];
fn metric(name: M, value: Option<impl ToString>, unit: U) -> OpportunityMetric {
    OpportunityMetric {
        name,
        value: value.map(|v| v.to_string()),
        unit,
    }
}
fn count(name: M, value: impl ToString) -> OpportunityMetric {
    metric(name, Some(value), U::Count)
}
fn proofs(s: &Snapshot, scope: &Scope, rows: &[&PricedMeasurement]) -> Vec<InspectionEvidence> {
    let mut out = vec![];
    for row in rows {
        if let Some(thread) = row.fact.thread_id.as_deref()
            && !out
                .iter()
                .any(|e: &InspectionEvidence| e.thread_id == thread)
        {
            out.push(evidence(
                s,
                scope,
                thread,
                row.fact.turn_id.as_deref(),
                None,
            ));
            if out.len() == 3 {
                break;
            }
        }
    }
    out
}
fn amount(summary: &UsageSummary) -> Option<Decimal> {
    (summary.price.status.as_ref() == "priced")
        .then(|| summary.price.cost.as_ref()?.parse().ok())
        .flatten()
}
fn sensitive(path: &str) -> bool {
    let name = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase();
    name == ".env"
        || name.starts_with(".env.")
        || matches!(
            name.as_str(),
            "id_rsa" | "id_ed25519" | "id_ecdsa" | "credentials" | "credentials.json" | ".npmrc"
        )
}
fn absolute(path: &str) -> bool {
    path.starts_with('/') || path.starts_with("\\\\") || path.as_bytes().get(1) == Some(&b':')
}
fn outside(project: &str, path: &str) -> Option<bool> {
    if !absolute(path) {
        return None;
    }
    let root = adapters::review_target(project, ".")?;
    let target = adapters::review_target(project, path)?;
    let (root, path) = if root.platform == SourcePathPlatform::Windows {
        (
            root.path.to_ascii_lowercase(),
            target.path.to_ascii_lowercase(),
        )
    } else {
        (root.path, target.path)
    };
    Some(path != root && !path.starts_with(&(root.trim_end_matches('/').to_owned() + "/")))
}
pub(super) struct Builder {
    checks: BTreeMap<Rule, OpportunityCheck>,
    policy: OpportunityPolicy,
    path_work: usize,
    observed_tasks: usize,
    operation_counts: BTreeMap<String, usize>,
    model_tasks: BTreeMap<Option<String>, BTreeSet<String>>,
    polling: Vec<(String, String, InspectionEvidence, usize)>,
}
impl Builder {
    pub(super) fn new(
        s: &Snapshot,
        scope: &Scope,
        rows: &[&PricedMeasurement],
        baseline: Option<(&Scope, &[&PricedMeasurement])>,
    ) -> Result<Self> {
        let checks = RULES
            .into_iter()
            .map(|rule| {
                (
                    rule,
                    OpportunityCheck {
                        rule,
                        status: OpportunityStatus::Miss,
                        gaps: vec![],
                        finding_count: 0,
                        findings: vec![],
                    },
                )
            })
            .collect();
        let mut out = Self {
            checks,
            policy: OpportunityPolicy::default(),
            path_work: 0,
            observed_tasks: 0,
            operation_counts: BTreeMap::new(),
            model_tasks: BTreeMap::new(),
            polling: vec![],
        };
        if quality(s, rows.len()).status == "partial" {
            for rule in RULES {
                out.gap(rule, G::SourcePartial);
            }
        }
        for rule in [
            Rule::RiskyCommand,
            Rule::SecretExposure,
            Rule::SensitiveOutbound,
            Rule::RepeatedRiskyDecline,
            Rule::PermissionFriction,
            Rule::UnansweredQuestion,
            Rule::LongInteraction,
            Rule::FrequentPolling,
        ] {
            out.gap(rule, G::RuntimeCoverage);
        }
        out.cost(s, scope, rows, baseline)?;
        Ok(out)
    }
    fn gap(&mut self, rule: Rule, gap: G) {
        let c = self.checks.get_mut(&rule).unwrap();
        if !c.gaps.contains(&gap) {
            c.gaps.push(gap);
        }
    }
    fn observed(&mut self, rule: Rule) {
        self.checks
            .get_mut(&rule)
            .unwrap()
            .gaps
            .retain(|g| *g != G::RuntimeCoverage);
    }
    fn add(
        &mut self,
        rule: Rule,
        object: Option<String>,
        metrics: Vec<OpportunityMetric>,
        proofs: Vec<InspectionEvidence>,
        baseline_evidence: Vec<InspectionEvidence>,
    ) {
        let check = self.checks.get_mut(&rule).unwrap();
        check.finding_count += 1;
        check.status = OpportunityStatus::Hit;
        if check.findings.len() < LIMIT {
            let id = crate::hash(
                serde_json::to_vec(&(
                    rule,
                    &object,
                    proofs
                        .first()
                        .map(|e| (&e.thread_id, &e.turn_id, &e.operation_id)),
                ))
                .unwrap(),
            );
            check.findings.push(OpportunityFinding {
                id,
                object,
                metrics,
                evidence: proofs,
                baseline_evidence,
                safety_labels: vec![],
            });
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn thread(
        &mut self,
        s: &Snapshot,
        scope: &Scope,
        t: &crate::usage_store::ThreadEntry,
        ops: &[Operation],
        events: &[Arc<Event>],
        rows: &[&PricedMeasurement],
        tz: Tz,
    ) -> Result<()> {
        if !ops.is_empty() {
            self.observed_tasks += 1;
        }
        self.operation_counts.insert(t.thread.id.clone(), ops.len());
        let mut targets: BTreeMap<String, Vec<ReadMatchTarget>> = BTreeMap::new();
        for op in ops {
            let reads = op
                .matching
                .as_ref()
                .map(|m| m.read_targets.clone())
                .unwrap_or_default();
            for target in &reads {
                if sensitive(&target.path) {
                    self.add(
                        Rule::SensitiveRead,
                        Some(target.path.clone()),
                        vec![count(M::Operations, 1)],
                        vec![evidence(
                            s,
                            scope,
                            &t.thread.id,
                            op.turn_id.as_deref(),
                            Some(&op.id),
                        )],
                        vec![],
                    );
                }
            }
            targets.insert(op.id.clone(), reads);
            if let Some(w) = &op.work
                && let WorkData::FileChange {
                    changes: Some(changes),
                } = &w.data
            {
                for path in changes.iter().flat_map(|c| c.targets()) {
                    self.path_work += 1;
                    if self.path_work > MAX_WORK {
                        return Err(limit());
                    }
                    let proof = vec![evidence(
                        s,
                        scope,
                        &t.thread.id,
                        op.turn_id.as_deref(),
                        Some(&op.id),
                    )];
                    if sensitive(path) {
                        self.add(
                            Rule::SensitiveChange,
                            Some(path.into()),
                            vec![count(M::Operations, 1)],
                            proof.clone(),
                            vec![],
                        );
                    }
                    match t.thread.project.as_deref().and_then(|p| outside(p, path)) {
                        Some(true) => self.add(
                            Rule::OutsideProjectChange,
                            Some(path.into()),
                            vec![count(M::Operations, 1)],
                            proof,
                            vec![],
                        ),
                        None => self.gap(Rule::OutsideProjectChange, G::PathIdentity),
                        _ => {}
                    }
                }
            }
            if op
                .matching
                .as_ref()
                .is_none_or(|m| m.read_targets.is_empty())
                && matches!(op.name.as_ref(), "read_file" | "view_image")
                && let Some(path) = &op.path
                && sensitive(path)
            {
                self.add(
                    Rule::SensitiveRead,
                    Some(path.clone()),
                    vec![count(M::Operations, 1)],
                    vec![evidence(
                        s,
                        scope,
                        &t.thread.id,
                        op.turn_id.as_deref(),
                        Some(&op.id),
                    )],
                    vec![],
                );
            }
        }
        if ops.is_empty() {
            for r in [
                Rule::SensitiveRead,
                Rule::SensitiveChange,
                Rule::OutsideProjectChange,
            ] {
                self.gap(r, G::NoObservations);
            }
        }
        let turns: BTreeSet<_> = rows
            .iter()
            .filter_map(|r| r.fact.turn_id.as_deref())
            .collect();
        let filtered = events
            .iter()
            .filter(|e| {
                (e.thread_id() == Some(t.thread.id.as_str())
                    || e.thread_id().is_none() && !e.gaps().is_empty())
                    && (!e.gaps().is_empty()
                        || (time_matches(e.time().timestamp.as_deref(), scope, tz)
                            && (!(scope.model.is_some()
                                || scope.model_unknown == Some(true)
                                || scope.reasoning_effort.is_some()
                                || scope.effort_unknown == Some(true))
                                || e.turn_id().is_some_and(|id| turns.contains(id)))))
            })
            .collect::<Vec<_>>();
        self.runtime(s, scope, t, ops, &targets, &filtered, tz)?;
        Ok(())
    }
    pub(super) fn finish(mut self, s: &Snapshot, tz: Tz) -> Result<OpportunityReview> {
        let cutoff = DateTime::parse_from_rfc3339(&s.manifest.snapshot_ref.created_at)
            .map_err(|_| invalid("检查视图的观察时间无效"))?
            .with_timezone(&tz)
            .date_naive();
        self.polling.retain(|(_, day, _, _)| {
            date(day).is_ok_and(|day| {
                day <= cutoff
                    && day
                        >= cutoff - Duration::days(i64::from(self.policy.polling_window_days) - 1)
            })
        });
        let tasks: BTreeSet<_> = self.polling.iter().map(|p| &p.0).collect();
        let dates: BTreeSet<_> = self.polling.iter().map(|p| &p.1).collect();
        if self.observed_tasks >= self.policy.minimum_observed_tasks
            && tasks.len() >= self.policy.minimum_polling_tasks
            && dates.len() >= self.policy.minimum_polling_days
        {
            let hits = std::mem::take(&mut self.polling);
            for (id, _, proof, count_value) in hits {
                self.add(
                    Rule::FrequentPolling,
                    Some(id),
                    vec![count(M::Requests, count_value)],
                    vec![proof],
                    vec![],
                );
            }
        }
        let model_check = self.checks.get_mut(&Rule::ModelReview).unwrap();
        model_check.findings.retain_mut(|finding| {
            let Some(ids) = self.model_tasks.get(&finding.object) else {
                return false;
            };
            let mut counts: Vec<_> = ids
                .iter()
                .filter_map(|id| self.operation_counts.get(id).copied())
                .collect();
            if counts.len() != ids.len() || counts.len() < self.policy.minimum_model_tasks {
                return false;
            }
            counts.sort_unstable();
            let middle = counts.len() / 2;
            let median = if counts.len() % 2 == 0 {
                (counts[middle - 1] + counts[middle]) as f64 / 2.0
            } else {
                counts[middle] as f64
            };
            finding.metrics.push(count(M::MedianOperations, median));
            median <= self.policy.maximum_median_operations as f64
        });
        model_check.finding_count = model_check.findings.len();
        if model_check.finding_count == 0 {
            model_check.status = OpportunityStatus::Miss;
        }
        // A short task is a review trigger, never proof that a cheaper model suffices.
        if self.operation_counts.is_empty() {
            self.gap(Rule::ModelReview, G::NoObservations);
        }
        for check in self.checks.values_mut() {
            if check.status != OpportunityStatus::Hit && !check.gaps.is_empty() {
                check.status = OpportunityStatus::Insufficient;
            }
        }
        Ok(OpportunityReview {
            method_version: 1,
            policy: self.policy,
            checks: self.checks.into_values().collect(),
            limit_per_check: LIMIT,
        })
    }
}
#[cfg(test)]
mod tests;

fn time_matches(at: Option<&str>, scope: &Scope, tz: Tz) -> bool {
    let day = at
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&tz).date_naive().to_string());
    if scope.undated == Some(true) {
        return day.is_none();
    }
    if scope.since.is_none() && scope.until.is_none() {
        return true;
    }
    day.is_some_and(|d| {
        scope.since.as_ref().is_none_or(|s| d >= *s) && scope.until.as_ref().is_none_or(|u| d < *u)
    })
}
