//! Independent check outcomes: absent findings never imply unsupported rules passed.
use super::detection::known_body;
use crate::{config::View, config_dto::Kind, optimize_dto::*};
pub(super) fn catalog() -> Vec<RuleDefinition> {
    let text = vec![Kind::Rule, Kind::Skill];
    [
        (
            "missingInstruction",
            vec![Kind::Rule],
            "authorizedExistenceCheck",
        ),
        ("fileSize", vec![Kind::Rule], "productReminder"),
        (
            "instructionSelection",
            vec![Kind::Rule],
            "effectiveHostConfiguration",
        ),
        ("skillFormat", vec![Kind::Skill], "agentSkillsSpecification"),
        (
            "descriptionStandard",
            vec![Kind::Skill],
            "agentSkillsSpecification",
        ),
        ("descriptionSize", vec![Kind::Skill], "productReminder"),
        ("bodyTokens", vec![Kind::Skill], "referenceEncodingOnly"),
        (
            "localReference",
            text.clone(),
            "authorizedMarkdownResources",
        ),
        ("exactInstructionBlocks", text.clone(), "staticExactBlocks"),
        (
            "declaredCopyDrift",
            text.clone(),
            "explicitSourceCopyRelation",
        ),
        (
            "skillDependency",
            vec![Kind::Skill],
            "effectiveHostDependencyResolution",
        ),
        (
            "hookTarget",
            vec![Kind::Hook],
            "effectiveTrustedEnabledHookRegistry",
        ),
        (
            "runtimeDuplicateInjection",
            text,
            "requestContextGenerationPositions",
        ),
        (
            "skillInactivity",
            vec![Kind::Skill],
            "continuousEnabledCoverage30Days",
        ),
        (
            "mcpInactivity",
            vec![Kind::Mcp],
            "continuousEnabledCoverage30Days",
        ),
        ("mcpFault", vec![Kind::Mcp], "verifiedRuntimeConnection"),
    ]
    .into_iter()
    .map(|(rule, kinds, basis)| RuleDefinition {
        rule: rule.into(),
        version: RuleParameters::default().version,
        kinds,
        basis: basis.into(),
    })
    .collect()
}
#[cfg(test)]
pub(crate) fn checks(
    view: &View,
    rules: &RuleParameters,
    item: &crate::config_dto::Item,
    findings: &[Finding],
) -> Vec<RuleAssessment> {
    checks_for(view, rules, item, findings, None)
}
pub(crate) fn checks_for(
    view: &View,
    rules: &RuleParameters,
    item: &crate::config_dto::Item,
    findings: &[Finding],
    project: Option<&str>,
) -> Vec<RuleAssessment> {
    catalog()
        .into_iter()
        .filter(|d| d.kinds.contains(&item.kind))
        .map(|definition| {
            let matched: Vec<_> = findings
                .iter()
                .filter(|f| f.rule == definition.rule)
                .cloned()
                .collect();
            let (outcome, reason) = if !item.current || item.stale {
                (RuleOutcome::Insufficient, Some("currentVersionUnavailable"))
            } else if definition.rule != "hookTarget"
                && item.measurement_status != "complete"
                && !(definition.rule == "missingInstruction"
                    && item.measurement_status == "missing")
            {
                (RuleOutcome::Insufficient, Some("checkEvidenceIncomplete"))
            } else if !matched.is_empty() {
                (RuleOutcome::Hit, None)
            } else {
                let known = match definition.rule.as_str() {
                    "hookTarget" => {
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
                                        && project.is_none_or(|scope| scope == *p)
                                })
                                .collect();
                            Some(
                                !projects.is_empty()
                                    && projects.iter().all(|p| {
                                        view.analysis
                                            .hook_checks
                                            .get(&(item.id.clone(), (*p).clone()))
                                            == Some(&true)
                                    }),
                            )
                        }
                    }
                    "missingInstruction" => Some(matches!(
                        item.measurement_status.as_str(),
                        "complete" | "missing"
                    )),
                    "fileSize" => {
                        Some(item.measurement_status == "complete" && item.bytes.is_some())
                    }
                    "skillFormat" => Some(
                        item.skill_metadata
                            .as_ref()
                            .is_some_and(|m| matches!(m.status.as_str(), "parsed" | "invalid")),
                    ),
                    "descriptionStandard" | "descriptionSize" => Some(
                        item.skill_metadata
                            .as_ref()
                            .is_some_and(|m| m.description_characters.is_some()),
                    ),
                    "bodyTokens" => Some(known_body(item).is_some()),
                    "exactInstructionBlocks" => Some(view.analysis.blocks_complete(&item.id)),
                    "localReference" => Some(
                        view.analysis
                            .reference_checks
                            .get(&item.id)
                            .is_some_and(|c| c.complete),
                    ),
                    "declaredCopyDrift" => view.analysis.copy_complete(&item.id),
                    _ => None,
                };
                match known {
                    Some(true) => (RuleOutcome::Miss, None),
                    Some(false) => (RuleOutcome::Insufficient, Some("checkEvidenceIncomplete")),
                    None => (
                        RuleOutcome::Unsupported,
                        Some(match definition.rule.as_str() {
                            "declaredCopyDrift" => "copyRelationNotDeclared",
                            "skillInactivity" | "mcpInactivity" => "continuousCoverageUnavailable",
                            "runtimeDuplicateInjection" => "runtimeInjectionUnavailable",
                            _ => "verifiedHostAdapterUnavailable",
                        }),
                    ),
                }
            };
            RuleAssessment {
                rule: definition.rule,
                rule_version: rules.version.clone(),
                item_id: item.id.clone(),
                content_version: item.content_hash.clone(),
                checked_at: view.checked.clone(),
                outcome,
                reason: reason.map(str::to_owned),
                findings: matched,
            }
        })
        .collect()
}
