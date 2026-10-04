//! User decisions and rule rechecks update independent facts in one transaction.
use super::{registry, store};
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
    if let Some(previous) = &old {
        suggestion = previous.clone();
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
        if suggestion
            .decision
            .as_ref()
            .is_some_and(|d| d.kind == kind && d.reason == reason)
        {
            return Ok(());
        }
        Some(UserDecision {
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
    let findings: BTreeMap<_, _> = current
        .iter()
        .map(|s| (s.item.id.as_str(), s.findings.as_slice()))
        .collect();
    for (id, seq) in targets {
        let mut suggestion = match seq {
            Some(seq) => store::get(tx, seq)?,
            None => current_by_id[id].clone(),
        };
        let previous = serde_json::to_value(&suggestion)?;
        let original_rules: BTreeSet<_> =
            suggestion.findings.iter().map(|f| f.rule.clone()).collect();
        let item = items.get(suggestion.item.id.as_str()).copied();
        if suggestion.review_baseline.is_none() {
            suggestion.review_baseline = Some(suggestion.item.clone());
        }
        let mut checks = registry::checks_for(
            view,
            rules,
            item.unwrap_or(&suggestion.item),
            findings
                .get(suggestion.item.id.as_str())
                .copied()
                .unwrap_or_default(),
            request.project.as_deref(),
        );
        checks.retain(|c| original_rules.contains(&c.rule));
        for check in &mut checks {
            if check.rule == "hookTarget" {
                let original_projects: BTreeSet<_> = suggestion
                    .findings
                    .iter()
                    .filter_map(|f| {
                        f.evidence
                            .as_ref()?
                            .hook
                            .as_ref()
                            .map(|h| h.project.as_str())
                    })
                    .collect();
                check.findings.retain(|f| {
                    f.evidence
                        .as_ref()
                        .and_then(|e| e.hook.as_ref())
                        .is_some_and(|h| original_projects.contains(h.project.as_str()))
                });
                check.outcome = if !check.findings.is_empty() {
                    RuleOutcome::Hit
                } else if !original_projects.is_empty()
                    && original_projects.iter().all(|p| {
                        view.analysis
                            .hook_checks
                            .get(&(suggestion.item.id.clone(), (*p).into()))
                            == Some(&true)
                    })
                {
                    RuleOutcome::Miss
                } else {
                    RuleOutcome::Insufficient
                };
                check.reason = (check.outcome == RuleOutcome::Insufficient)
                    .then(|| "checkEvidenceIncomplete".into());
            }
            if check.outcome == RuleOutcome::Miss
                && suggestion
                    .findings
                    .iter()
                    .filter(|f| f.rule == check.rule)
                    .any(|f| !view.analysis.complete_finding(&suggestion.item.id, f))
            {
                check.outcome = RuleOutcome::Insufficient;
                check.reason = Some("checkEvidenceIncomplete".into());
            }
        }
        if item.is_none_or(|i| !i.current || i.stale || i.measurement_status == "missing") {
            for check in &mut checks {
                check.outcome = RuleOutcome::Insufficient;
                check.reason = Some("currentVersionUnavailable".into());
                check.findings.clear();
            }
        }
        suggestion.status = if checks.iter().any(|c| c.outcome == RuleOutcome::Hit) {
            "stillNeedsReview"
        } else if !checks.is_empty() && checks.iter().all(|c| c.outcome == RuleOutcome::Miss) {
            "verified"
        } else {
            "recheckUnavailable"
        }
        .into();
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
