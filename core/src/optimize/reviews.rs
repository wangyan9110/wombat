//! User decisions and rule rechecks update independent facts in one transaction.
use super::{evaluation, store};
use crate::{config::View, dto::operation_error, optimize_dto::*};
use anyhow::Result;
use rusqlite::Transaction;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn decide(
    tx: &Transaction<'_>,
    request: &Request,
    current: &[Suggestion],
    states: &BTreeMap<String, store::State>,
) -> Result<()> {
    let target = request
        .suggestion_id
        .as_ref()
        .ok_or_else(|| operation_error("INVALID_ARGUMENT", "需要建议身份"))?;
    let old = states
        .get(target)
        .map(|s| store::get(tx, s.seq))
        .transpose()?;
    let mut suggestion = if request.action == Action::Redisplay {
        old.clone().filter(|s| s.decision.is_some())
    } else {
        current.iter().find(|s| s.id == *target).cloned()
    }
    .ok_or_else(|| operation_error("NOT_FOUND", "建议已变化或不存在"))?;
    if request.action == Action::Redisplay
        && let Some(previous) = &old
    {
        suggestion = previous.clone();
    }
    // The first persisted observation owns the baseline, even if this decision
    // uses a later captured check with the same group/content identity.
    if let Some(previous) = &old {
        suggestion.review_baseline = previous.review_baseline.clone();
    }
    let decision = if request.action == Action::Redisplay {
        None
    } else {
        let reason = request
            .decision_reason
            .clone()
            .ok_or_else(|| operation_error("INVALID_ARGUMENT", "需要决定原因"))?;
        let kind = if request.action == Action::Keep {
            if reason != DecisionReason::Necessary {
                return Err(operation_error("INVALID_ARGUMENT", "保留需要说明仍有必要"));
            }
            DecisionKind::Keep
        } else {
            if reason == DecisionReason::Necessary {
                return Err(operation_error(
                    "INVALID_ARGUMENT",
                    "不适用需要对象或证据原因",
                ));
            }
            DecisionKind::NotApplicable
        };
        if old
            .as_ref()
            .and_then(|s| s.decision.as_ref())
            .is_some_and(|d| {
                d.kind == kind
                    && d.reason == reason
                    && super::identity::decision_applies(d, &suggestion)
            })
        {
            return Ok(());
        }
        Some(UserDecision {
            binding: super::identity::binding(&suggestion),
            kind,
            reason,
            recorded_at: chrono::Utc::now().to_rfc3339(),
        })
    };
    suggestion.decision = decision;
    let kind = if request.action == Action::Redisplay {
        RecordKind::Redisplay
    } else {
        RecordKind::Decision
    };
    store::append(tx, &mut suggestion, kind)
}

pub(super) fn recheck(
    tx: &Transaction<'_>,
    request: &Request,
    current: &[Suggestion],
    states: &BTreeMap<String, store::State>,
    view: &View,
    rules: &RuleParameters,
) -> Result<()> {
    let current_by_id: BTreeMap<_, _> = current.iter().map(|s| (s.id.as_str(), s)).collect();
    if let Some(id) = &request.suggestion_id
        && !states.contains_key(id)
        && !current_by_id.contains_key(id.as_str())
    {
        return Err(operation_error("NOT_FOUND", "未找到复查对象"));
    }
    // Iterate lightweight identities; decode only one historical object at a time.
    let targets = states
        .iter()
        .filter(|(_, state)| state.status != "verified" || request.suggestion_id.is_some())
        .map(|(id, state)| (id.as_str(), Some(state.seq)))
        .chain(
            current_by_id
                .keys()
                .filter(|id| !states.contains_key(**id))
                .map(|id| (*id, None)),
        )
        .filter(|(id, _)| {
            request
                .suggestion_id
                .as_ref()
                .is_none_or(|target| target == id)
        });
    let items: BTreeMap<_, _> = view.items.iter().map(|i| (i.id.as_str(), i)).collect();
    for (id, seq) in targets {
        let mut suggestion = match seq {
            Some(seq) => store::get(tx, seq)?,
            None => current_by_id[id].clone(),
        };
        let previous = serde_json::to_value(&suggestion)?;
        let item = items.get(suggestion.item.id.as_str()).copied();
        super::identity::capture(&mut suggestion);
        let baseline = suggestion.review_baseline.as_ref().ok_or_else(|| {
            operation_error("REVIEWS_UNAVAILABLE", "原始检查依据缺失，原数据未被更改")
        })?;
        let checks = evaluation::evaluate(&evaluation::Input {
            view,
            parameters: rules,
            item: item.unwrap_or(&suggestion.item),
            project: request.project.as_deref(),
            source: request.source_instance_id.as_deref(),
            current_available: item.is_some(),
            baseline: Some(evaluation::Baseline {
                findings: &suggestion.findings,
                assessments: &baseline.assessments,
                scope: &baseline.scope,
            }),
        });
        let original_rules: BTreeSet<_> = suggestion
            .findings
            .iter()
            .map(|f| f.rule.as_str())
            .collect();
        suggestion.status = status(&checks, original_rules.len()).into();
        suggestion.checks = checks;
        suggestion.checked_at = view.checked.clone();
        suggestion.recheck_rule_parameters = Some(rules.clone());
        if let Some(item) = item {
            suggestion.item = item.clone();
        }
        if serde_json::to_value(&suggestion)? != previous {
            store::append(tx, &mut suggestion, RecordKind::Recheck)?;
        }
    }
    Ok(())
}

pub(super) fn status(checks: &[RuleAssessment], original_rules: usize) -> &'static str {
    if checks.iter().any(|c| c.outcome == RuleOutcome::Hit) {
        "stillNeedsReview"
    } else if !checks.is_empty()
        && checks.len() == original_rules
        && checks.iter().all(|c| {
            c.outcome == RuleOutcome::Miss && c.comparison.status == ComparisonStatus::Comparable
        })
    {
        "verified"
    } else {
        "recheckUnavailable"
    }
}
