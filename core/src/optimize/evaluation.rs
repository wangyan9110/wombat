//! Pure rule assessments over one captured inventory and its bounded static analysis.
use super::registry::Rule;
use crate::{
    config::View,
    config_dto::{Item, SkillMetadata},
    optimize_dto::*,
};
use std::collections::BTreeSet;

pub(super) struct Baseline<'a> {
    pub findings: &'a [Finding],
    pub parameters: Option<&'a RuleParameters>,
    pub rule_version: &'a str,
}
pub(super) struct Input<'a> {
    pub view: &'a View,
    pub item: &'a Item,
    pub parameters: &'a RuleParameters,
    pub project: Option<&'a str>,
    pub baseline: Option<Baseline<'a>>,
    pub current_available: bool,
}
impl<'a> Input<'a> {
    pub(super) fn initial(
        view: &'a View,
        item: &'a Item,
        parameters: &'a RuleParameters,
        project: Option<&'a str>,
    ) -> Self {
        Self {
            view,
            item,
            parameters,
            project,
            baseline: None,
            current_available: true,
        }
    }
}

enum Assessment {
    Hit(Vec<Finding>),
    Miss,
    Insufficient(&'static str),
    Unsupported(&'static str),
}
#[derive(Debug)]
enum EvaluationError {
    InvalidAnalysisRange,
}

pub(super) fn evaluate(input: &Input<'_>) -> Vec<RuleAssessment> {
    Rule::ALL
        .into_iter()
        .filter(|rule| rule.applies(&input.item.kind))
        .filter(|rule| {
            input
                .baseline
                .as_ref()
                .is_none_or(|b| b.findings.iter().any(|f| f.rule == rule.id()))
        })
        .map(|rule| {
            let (outcome, reason, findings) = match assess(rule, input) {
                Ok(Assessment::Hit(findings)) => (RuleOutcome::Hit, None, findings),
                Ok(Assessment::Miss) => (RuleOutcome::Miss, None, vec![]),
                Ok(Assessment::Insufficient(reason)) => {
                    (RuleOutcome::Insufficient, Some(reason), vec![])
                }
                Ok(Assessment::Unsupported(reason)) => {
                    (RuleOutcome::Unsupported, Some(reason), vec![])
                }
                Err(EvaluationError::InvalidAnalysisRange) => {
                    (RuleOutcome::Error, Some("invalidAnalysisEvidence"), vec![])
                }
            };
            RuleAssessment {
                rule: rule.id().into(),
                rule_version: input.parameters.version.clone(),
                item_id: input.item.id.clone(),
                content_version: input.item.content_hash.clone(),
                checked_at: input.view.checked.clone(),
                outcome,
                reason: reason.map(str::to_owned),
                findings,
            }
        })
        .collect()
}

fn assess(rule: Rule, input: &Input<'_>) -> Result<Assessment, EvaluationError> {
    let item = input.item;
    if !input.current_available
        || !item.current
        || item.stale
        || input.baseline.is_some() && item.measurement_status == "missing"
    {
        return Ok(Assessment::Insufficient("currentVersionUnavailable"));
    }
    if !matches!(rule, Rule::HookTarget)
        && item.measurement_status != "complete"
        && !(matches!(rule, Rule::MissingInstruction) && item.measurement_status == "missing")
    {
        return Ok(Assessment::Insufficient("checkEvidenceIncomplete"));
    }
    let result = condition(rule, input)?;
    // Resolution requires the original rule/parameters and complete original scope.
    // A current hit remains useful even when the original scope cannot be cleared.
    if matches!(result, Assessment::Miss)
        && let Some(baseline) = &input.baseline
    {
        if baseline.rule_version != input.parameters.version
            || baseline
                .parameters
                .is_none_or(|p| !same_parameters(rule, p, input.parameters))
        {
            return Ok(Assessment::Insufficient("ruleParametersChanged"));
        }
        if baseline
            .findings
            .iter()
            .filter(|f| f.rule == rule.id())
            .any(|f| !input.view.analysis.complete_finding(&item.id, f))
        {
            return Ok(Assessment::Insufficient("checkEvidenceIncomplete"));
        }
    }
    Ok(result)
}
fn same_parameters(rule: Rule, left: &RuleParameters, right: &RuleParameters) -> bool {
    left.version == right.version
        && left.applicability == right.applicability
        && match rule {
            Rule::FileSize => agents_bytes(left) == agents_bytes(right),
            Rule::DescriptionStandard => {
                left.description_standard_max == right.description_standard_max
            }
            Rule::DescriptionSize => {
                description_characters(left) == description_characters(right)
                    && left.description_standard_max == right.description_standard_max
            }
            Rule::BodyTokens => left.body_tokens == right.body_tokens,
            _ => true,
        }
}
fn agents_bytes(p: &RuleParameters) -> u64 {
    p.overrides.agents_bytes.unwrap_or(p.agents_bytes_default)
}
fn description_characters(p: &RuleParameters) -> u64 {
    p.overrides
        .description_characters
        .unwrap_or(p.description_characters_default)
}
fn finding(
    rule: Rule,
    basis: &str,
    observed: Option<u64>,
    threshold: Option<u64>,
    codes: Vec<String>,
) -> Finding {
    Finding {
        rule: rule.id().into(),
        status: "failed".into(),
        observed,
        threshold,
        evidence_codes: codes,
        basis: Some(basis.into()),
        evidence: None,
    }
}
fn numeric(
    rule: Rule,
    basis: &str,
    observed: Option<u64>,
    threshold: u64,
    inclusive: bool,
) -> Assessment {
    match observed {
        Some(n) if n > threshold || inclusive && n == threshold => {
            Assessment::Hit(vec![finding(rule, basis, Some(n), Some(threshold), vec![])])
        }
        Some(_) => Assessment::Miss,
        None => Assessment::Insufficient("checkEvidenceIncomplete"),
    }
}
fn known_body(item: &Item) -> Option<u64> {
    item.body_token_estimate
        .as_ref()
        .filter(|e| {
            item.body_estimate_status == "estimated"
                && e.payload == "skillBody"
                && e.method == "tiktoken-rs-0.12.0/o200k_base/ordinary-v1"
                && e.encoding == "o200k_base"
                && e.tokenizer_version.as_deref() == Some("tiktoken-rs-0.12.0")
                && e.applicability == "referenceEncodingOnly"
                && !e.content_hash.is_empty()
        })
        .map(|e| e.tokens)
}
/// Prepared inputs contain only the measurements and bounded analysis a rule consumes.
enum RuleInput<'a> {
    Existence {
        missing: bool,
    },
    Numeric {
        basis: &'static str,
        observed: Option<u64>,
        threshold: u64,
        inclusive: bool,
    },
    Format(Option<&'a SkillMetadata>),
    Satisfied,
    Static {
        findings: Vec<&'a Finding>,
        complete: Option<bool>,
        unsupported_reason: &'static str,
    },
    Unsupported(&'static str),
}
fn condition(rule: Rule, input: &Input<'_>) -> Result<Assessment, EvaluationError> {
    assess_prepared(rule, prepare(rule, input))
}
fn prepare<'a>(rule: Rule, input: &'a Input<'_>) -> RuleInput<'a> {
    let item = input.item;
    let rules = input.parameters;
    match rule {
        Rule::MissingInstruction => RuleInput::Existence {
            missing: item.configured_state == "missing" && item.measurement_status == "missing",
        },
        Rule::FileSize => RuleInput::Numeric {
            basis: "productReminder",
            observed: item.bytes,
            threshold: agents_bytes(rules),
            inclusive: false,
        },
        Rule::SkillFormat => RuleInput::Format(item.skill_metadata.as_ref()),
        Rule::DescriptionStandard => RuleInput::Numeric {
            basis: "agentSkillsSpecification",
            observed: item
                .skill_metadata
                .as_ref()
                .and_then(|m| m.description_characters),
            threshold: rules.description_standard_max,
            inclusive: false,
        },
        Rule::DescriptionSize => {
            let observed = item
                .skill_metadata
                .as_ref()
                .and_then(|m| m.description_characters);
            if observed.is_some_and(|n| n > rules.description_standard_max) {
                RuleInput::Satisfied
            } else {
                RuleInput::Numeric {
                    basis: "productReminder",
                    observed,
                    threshold: description_characters(rules),
                    inclusive: false,
                }
            }
        }
        Rule::BodyTokens => RuleInput::Numeric {
            basis: "agentSkillsRecommendation",
            observed: item
                .skill_metadata
                .as_ref()
                .filter(|m| m.status == "parsed")
                .and_then(|_| known_body(item)),
            threshold: rules.body_tokens,
            inclusive: true,
        },
        Rule::LocalReference
        | Rule::ExactInstructionBlocks
        | Rule::DeclaredCopyDrift
        | Rule::HookTarget => prepare_static(rule, input),
        Rule::SkillInactivity | Rule::McpInactivity => {
            RuleInput::Unsupported("continuousCoverageUnavailable")
        }
        Rule::RuntimeDuplicateInjection => RuleInput::Unsupported("runtimeInjectionUnavailable"),
        Rule::InstructionSelection | Rule::SkillDependency | Rule::McpFault => {
            RuleInput::Unsupported("verifiedHostAdapterUnavailable")
        }
    }
}
fn assess_prepared(rule: Rule, input: RuleInput<'_>) -> Result<Assessment, EvaluationError> {
    Ok(match input {
        RuleInput::Existence { missing: true } => {
            let mut f = finding(rule, "authorizedExistenceCheck", None, None, vec![]);
            f.status = "informational".into();
            Assessment::Hit(vec![f])
        }
        RuleInput::Existence { missing: false } | RuleInput::Satisfied => Assessment::Miss,
        RuleInput::Numeric {
            basis,
            observed,
            threshold,
            inclusive,
        } => numeric(rule, basis, observed, threshold, inclusive),
        RuleInput::Format(Some(m)) if m.status == "invalid" => Assessment::Hit(vec![finding(
            rule,
            "fieldFormat",
            None,
            None,
            m.issues.clone(),
        )]),
        RuleInput::Format(Some(m)) if m.status == "parsed" => Assessment::Miss,
        RuleInput::Format(_) => Assessment::Insufficient("checkEvidenceIncomplete"),
        RuleInput::Unsupported(reason) => Assessment::Unsupported(reason),
        RuleInput::Static {
            findings,
            complete,
            unsupported_reason,
        } => {
            for f in &findings {
                check_intervals(f)?;
            }
            if !findings.is_empty() {
                Assessment::Hit(findings.into_iter().cloned().collect())
            } else {
                match complete {
                    Some(true) => Assessment::Miss,
                    Some(false) => Assessment::Insufficient("checkEvidenceIncomplete"),
                    None => Assessment::Unsupported(unsupported_reason),
                }
            }
        }
    })
}
fn check_intervals(finding: &Finding) -> Result<(), EvaluationError> {
    // Source-derived positions are intervals. Invalid intervals cannot establish
    // a static hit and fail only the rule consuming that analysis.
    if let Some(e) = &finding.evidence {
        for p in &e.positions {
            p.end_byte
                .checked_sub(p.start_byte)
                .ok_or(EvaluationError::InvalidAnalysisRange)?;
            p.end_line
                .checked_sub(p.start_line)
                .ok_or(EvaluationError::InvalidAnalysisRange)?;
        }
        for r in &e.references {
            r.end_byte
                .checked_sub(r.start_byte)
                .ok_or(EvaluationError::InvalidAnalysisRange)?;
            r.end_line
                .checked_sub(r.start_line)
                .ok_or(EvaluationError::InvalidAnalysisRange)?;
        }
    }
    Ok(())
}

fn prepare_static<'a>(rule: Rule, input: &'a Input<'_>) -> RuleInput<'a> {
    let item = input.item;
    let view = input.view;
    let baseline_projects: Option<BTreeSet<_>> = input.baseline.as_ref().map(|b| {
        b.findings
            .iter()
            .filter(|f| f.rule == rule.id())
            .filter_map(|f| {
                f.evidence
                    .as_ref()?
                    .hook
                    .as_ref()
                    .map(|h| h.project.as_str())
            })
            .collect()
    });
    let included = |finding: &&Finding| {
        finding.rule == rule.id()
            && finding
                .evidence
                .as_ref()
                .and_then(|e| e.hook.as_ref())
                .is_none_or(|h| {
                    input.project.is_none_or(|p| p == h.project)
                        && baseline_projects
                            .as_ref()
                            .is_none_or(|p| p.contains(h.project.as_str()))
                })
    };
    let findings = view
        .analysis
        .findings
        .get(&item.id)
        .into_iter()
        .flatten()
        .filter(included)
        .collect();
    let complete = match rule {
        Rule::ExactInstructionBlocks => Some(view.analysis.blocks_complete(&item.id)),
        Rule::LocalReference => Some(
            view.analysis
                .reference_checks
                .get(&item.id)
                .is_some_and(|c| c.complete),
        ),
        Rule::DeclaredCopyDrift => view.analysis.copy_complete(&item.id),
        Rule::HookTarget => {
            if !cfg!(unix)
                || matches!(
                    view.hook_registry.status,
                    crate::config_dto::HookRegistryStatus::Unavailable
                )
            {
                None
            } else {
                let projects: Vec<_> = view
                    .projects
                    .iter()
                    .filter(|p| {
                        item.applies(None, Some(p))
                            && input.project.is_none_or(|scope| scope == *p)
                            && baseline_projects
                                .as_ref()
                                .is_none_or(|original| original.contains(p.as_str()))
                    })
                    .collect();
                Some(
                    !projects.is_empty()
                        && baseline_projects
                            .as_ref()
                            .is_none_or(|p| p.len() == projects.len())
                        && projects.iter().all(|p| {
                            view.analysis
                                .hook_checks
                                .get(&(item.id.clone(), (*p).clone()))
                                == Some(&true)
                        }),
                )
            }
        }
        _ => unreachable!("only static rules consume static analysis"),
    };
    RuleInput::Static {
        findings,
        complete,
        unsupported_reason: if matches!(rule, Rule::DeclaredCopyDrift) {
            "copyRelationNotDeclared"
        } else {
            "verifiedHostAdapterUnavailable"
        },
    }
}

#[cfg(test)]
mod prepared_tests {
    use super::*;
    #[test]
    fn static_constraint_requires_complete_analysis_even_when_no_issue_was_found() {
        for rule in [
            Rule::LocalReference,
            Rule::ExactInstructionBlocks,
            Rule::DeclaredCopyDrift,
            Rule::HookTarget,
        ] {
            assert!(matches!(
                assess_prepared(
                    rule,
                    RuleInput::Static {
                        findings: vec![],
                        complete: Some(true),
                        unsupported_reason: "analysisUnavailable",
                    }
                )
                .unwrap(),
                Assessment::Miss
            ));
            assert!(matches!(
                assess_prepared(
                    rule,
                    RuleInput::Static {
                        findings: vec![],
                        complete: Some(false),
                        unsupported_reason: "analysisUnavailable",
                    }
                )
                .unwrap(),
                Assessment::Insufficient("checkEvidenceIncomplete")
            ));
            assert!(matches!(
                assess_prepared(
                    rule,
                    RuleInput::Static {
                        findings: vec![],
                        complete: None,
                        unsupported_reason: "analysisUnavailable",
                    }
                )
                .unwrap(),
                Assessment::Unsupported("analysisUnavailable")
            ));
        }
    }
}
