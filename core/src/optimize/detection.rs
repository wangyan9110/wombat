//! Static rule thresholds and finding composition; no decision persistence.
use crate::{config::View, config_dto::Kind, dto::operation_error, optimize_dto::*};
use anyhow::Result;
pub(crate) fn parameters(overrides: Option<RuleOverrides>) -> Result<RuleParameters> {
    let overrides = overrides.unwrap_or_default();
    if overrides
        .agents_bytes
        .is_some_and(|n| n == 0 || n > 9_007_199_254_740_991)
        || overrides.description_characters.is_some_and(|n| n > 1024)
    {
        return Err(operation_error("INVALID_ARGUMENT", "整理提醒值无效"));
    }
    Ok(RuleParameters {
        overrides,
        ..Default::default()
    })
}
pub(super) fn known_body(item: &crate::config_dto::Item) -> Option<u64> {
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
#[cfg(test)]
pub(crate) fn detect(view: &View, rules: &RuleParameters) -> Vec<Suggestion> {
    detect_for(view, rules, None)
}
pub(crate) fn detect_for(
    view: &View,
    rules: &RuleParameters,
    project: Option<&str>,
) -> Vec<Suggestion> {
    let mut suggestions: Vec<_> = view
        .items
        .iter()
        .filter(|i| {
            i.current
                && !i.stale
                && (i.kind == Kind::Hook
                    || matches!(i.measurement_status.as_str(), "complete" | "missing"))
        })
        .filter_map(|item| {
            let mut findings = vec![];
            let finding = |rule: &str, basis: &str, observed, threshold, evidence_codes| Finding {
                rule: rule.into(),
                status: "failed".into(),
                observed,
                threshold,
                evidence_codes,
                basis: Some(basis.into()),
                evidence: None,
            };
            if item.kind == Kind::Rule
                && item.configured_state == "missing"
                && item.measurement_status == "missing"
            {
                let mut absent = finding(
                    "missingInstruction",
                    "authorizedExistenceCheck",
                    None,
                    None,
                    vec![],
                );
                absent.status = "informational".into();
                findings.push(absent);
            }
            if let Some(m) = &item.skill_metadata {
                if m.status == "invalid" {
                    findings.push(finding(
                        "skillFormat",
                        "fieldFormat",
                        None,
                        None,
                        m.issues.clone(),
                    ));
                }
                if let Some(n) = m.description_characters {
                    if n > rules.description_standard_max {
                        findings.push(finding(
                            "descriptionStandard",
                            "agentSkillsSpecification",
                            Some(n),
                            Some(rules.description_standard_max),
                            vec![],
                        ));
                    } else if n > rules
                        .overrides
                        .description_characters
                        .unwrap_or(rules.description_characters_default)
                    {
                        findings.push(finding(
                            "descriptionSize",
                            "productReminder",
                            Some(n),
                            Some(
                                rules
                                    .overrides
                                    .description_characters
                                    .unwrap_or(rules.description_characters_default),
                            ),
                            vec![],
                        ));
                    }
                }
                if m.status == "parsed"
                    && let Some(n) = known_body(item).filter(|n| *n >= rules.body_tokens)
                {
                    findings.push(finding(
                        "bodyTokens",
                        "agentSkillsRecommendation",
                        Some(n),
                        Some(rules.body_tokens),
                        vec![],
                    ));
                }
            }
            if item.kind == Kind::Rule
                && let Some(n) = item.bytes.filter(|n| {
                    *n > rules
                        .overrides
                        .agents_bytes
                        .unwrap_or(rules.agents_bytes_default)
                })
            {
                findings.push(finding(
                    "fileSize",
                    "productReminder",
                    Some(n),
                    Some(
                        rules
                            .overrides
                            .agents_bytes
                            .unwrap_or(rules.agents_bytes_default),
                    ),
                    vec![],
                ));
            }
            if findings.is_empty() {
                findings.extend(
                    view.analysis
                        .findings
                        .get(&item.id)
                        .cloned()
                        .unwrap_or_default(),
                );
                if findings.is_empty() {
                    return None;
                }
            } else {
                findings.extend(
                    view.analysis
                        .findings
                        .get(&item.id)
                        .cloned()
                        .unwrap_or_default(),
                );
            }
            findings.retain(|f| {
                project.is_none_or(|p| {
                    f.evidence
                        .as_ref()
                        .and_then(|e| e.hook.as_ref())
                        .is_none_or(|h| h.project == p)
                })
            });
            if findings.is_empty() {
                return None;
            }
            let category = if findings.iter().any(|f| {
                matches!(
                    f.rule.as_str(),
                    "skillFormat"
                        | "localReference"
                        | "descriptionStandard"
                        | "declaredCopyDrift"
                        | "hookTarget"
                )
            }) {
                Category::Repair
            } else {
                Category::Trim
            };
            let id = crate::hash(
                serde_json::to_vec(&(
                    &item.id,
                    &item.content_hash,
                    &rules.version,
                    rules
                        .overrides
                        .agents_bytes
                        .unwrap_or(rules.agents_bytes_default),
                    rules
                        .overrides
                        .description_characters
                        .unwrap_or(rules.description_characters_default),
                    rules.body_tokens,
                    rules.description_standard_max,
                    &findings,
                ))
                .ok()?,
            );
            Some(Suggestion {
                scope_project: None,
                id,
                item: item.clone(),
                category,
                status: "pending".into(),
                decision: None,
                checks: super::registry::checks_for(view, rules, item, &findings, project),
                findings,
                checked_at: view.checked.clone(),
                rule_version: rules.version.clone(),
                rule_parameters: Some(rules.clone()),
                recheck_rule_parameters: None,
                review_baseline: None,
                record_id: None,
                recorded_at: None,
                record_kind: None,
            })
        })
        .collect();
    suggestions.sort_by(|a, b| {
        let priority = |s: &Suggestion| {
            if s.findings.iter().any(|f| {
                matches!(
                    f.rule.as_str(),
                    "skillFormat" | "hookTarget" | "localReference"
                )
            }) {
                0
            } else if s.findings.iter().any(|f| f.rule == "descriptionStandard") {
                1
            } else if matches!(s.category, Category::Repair | Category::Trim) {
                2
            } else {
                3
            }
        };
        priority(a)
            .cmp(&priority(b))
            .then_with(|| {
                // The verified invocation-count basis currently exists only for MCP.
                // Treat other bases as unknown to keep the ordering transitive.
                let calls = |s: &Suggestion| {
                    if s.item.kind == Kind::Mcp {
                        s.item.usage_count
                    } else {
                        None
                    }
                };
                calls(b).cmp(&calls(a))
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    suggestions
}
