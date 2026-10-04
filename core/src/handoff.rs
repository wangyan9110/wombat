//! Select the entire authorized pending scope before display pagination or type filters.
use crate::{config::View, dto::operation_error, handoff_dto::*, optimize_dto};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};
pub(crate) fn prepare(r: Request, id: String, view: &View) -> Result<Response> {
    if r.language
        .as_deref()
        .is_some_and(|l| !matches!(l, "zh" | "en"))
    {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "Invalid handoff language",
        ));
    }
    if r.action == Action::Send && r.selection_version.is_none() {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "Handoff requires a reviewed selection",
        ));
    }
    let result = crate::optimize::pending_for_handoff(
        optimize_dto::Request {
            project: r.project.clone(),
            source_instance_id: r.source_instance_id,
            decision_revision: r.decision_revision,
            rule_overrides: r.rule_overrides,
            ..Default::default()
        },
        id.clone(),
        view,
    )?;
    let selected = r
        .suggestion_ids
        .map(|ids| ids.into_iter().collect::<BTreeSet<_>>());
    if selected
        .as_ref()
        .is_some_and(|ids| ids.is_empty() || ids.len() > 20_000)
    {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "Empty or excessive handoff selection",
        ));
    }
    let mut found = BTreeSet::new();
    let mut observations = Vec::new();
    let mut objects: BTreeMap<String, Target> = BTreeMap::new();
    for s in result
        .suggestions
        .into_iter()
        .filter(|s| selected.as_ref().is_none_or(|ids| ids.contains(&s.id)))
    {
        found.insert(s.id.clone());
        observations.push((s.id.clone(), s.record_id.clone(), s.checked_at.clone()));
        // A verified static reference does not require a contiguous declaration text span.
        let verified_hook = s.item.kind == crate::config_dto::Kind::Hook
            && !s.findings.is_empty()
            && s.findings.iter().all(|finding| {
                finding.rule == "hookTarget"
                    && finding.evidence.as_ref().is_some_and(|evidence| {
                        evidence.hook.is_some()
                            && evidence.versions.iter().any(|version| {
                                version.item_id == s.item.id
                                    && version.content_hash == s.item.content_hash
                            })
                    })
            });
        if !s.item.current
            || s.item.stale
            || (!verified_hook
                && !matches!(s.item.measurement_status.as_str(), "complete" | "missing"))
        {
            return Err(operation_error(
                "VIEW_EXPIRED",
                "Handoff target is not current",
            ));
        }
        let projects: Vec<_> = view
            .projects
            .iter()
            .filter(|p| s.item.applies(None, Some(p)))
            .filter(|p| {
                s.item.kind != crate::config_dto::Kind::Hook
                    || s.findings.iter().any(|f| {
                        f.evidence
                            .as_ref()
                            .and_then(|e| e.hook.as_ref())
                            .is_some_and(|h| &h.project == *p)
                    })
            })
            .cloned()
            .collect();
        if projects.is_empty() {
            return Err(operation_error(
                "INVALID_ARGUMENT",
                "Choose an authorized project for this target",
            ));
        }
        let target = objects.entry(s.item.id.clone()).or_insert_with(|| Target {
            item_id: s.item.id.clone(),
            suggestion_ids: vec![],
            path: s.item.path,
            content_hash: s.item.content_hash,
            expected_exists: s.item.measurement_status != "missing",
            shared_projects: projects,
            findings: vec![],
        });
        target.suggestion_ids.push(s.id);
        target.findings.extend(s.findings);
    }
    if selected.as_ref().is_some_and(|ids| ids != &found) {
        return Err(operation_error("VIEW_EXPIRED", "Handoff selection changed"));
    }
    let mut projects: BTreeMap<String, Project> = BTreeMap::new();
    for target in objects.into_values() {
        let cwd = r
            .project
            .as_ref()
            .filter(|p| target.shared_projects.contains(p))
            .unwrap_or(&target.shared_projects[0])
            .clone();
        let canonical = std::fs::canonicalize(&cwd)
            .map_err(|_| operation_error("VIEW_EXPIRED", "Project directory unavailable"))?;
        if canonical.to_string_lossy() != cwd {
            return Err(operation_error(
                "VIEW_EXPIRED",
                "Project directory identity changed",
            ));
        }
        projects
            .entry(cwd.clone())
            .or_insert_with(|| Project {
                id: crate::hash(&cwd),
                cwd,
                targets: vec![],
            })
            .targets
            .push(target);
    }
    let projects = projects.into_values().collect::<Vec<_>>();
    observations.sort();
    let version = crate::hash(serde_json::to_vec(&(&projects, observations))?);
    if r.selection_version.is_some_and(|old| old != version) {
        return Err(operation_error(
            "VIEW_EXPIRED",
            "Reviewed handoff selection changed",
        ));
    }
    Ok(Response {
        output_version: 1,
        action: r.action,
        selection_version: version,
        read_view: id,
        decision_revision: result.decision_revision,
        projects,
        deliveries: vec![],
        allowance_checks: vec![],
    })
}
