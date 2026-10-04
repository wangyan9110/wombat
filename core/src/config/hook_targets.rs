//! File-backed Hook reference facts; native trust is a prerequisite, never execution evidence.
mod command;
mod declarations;
mod native_commands;
use super::{analysis::Analysis, references::target_status};
use crate::{config_dto::*, optimize_dto::*};
use std::{collections::BTreeMap, path::Path};

pub(super) fn analyze(
    items: &[Item],
    projects: &[String],
    roots: &[String],
    registry: &HookRegistry,
    capture: Option<&super::hooks::Capture>,
    out: &mut Analysis,
) {
    let hooks: BTreeMap<_, _> = items
        .iter()
        .filter(|i| i.kind == Kind::Hook && i.current && !i.stale)
        .map(|i| (i.id.as_str(), i))
        .collect();
    if !cfg!(unix) {
        return;
    }
    let observed: std::collections::BTreeSet<_> = registry
        .contexts
        .iter()
        .flat_map(|c| &c.registrations)
        .filter(|r| {
            r.enabled
                && matches!(r.trust, HookTrust::Trusted | HookTrust::Managed)
                && matches!(r.handler, HookHandler::Command)
        })
        .map(|r| r.item_id.as_str())
        .collect();
    let scripts = declarations::read(
        observed.iter().filter_map(|id| hooks.get(id).copied()),
        roots,
    );
    let native_scripts = native_commands::read(capture, registry);
    let mut checks = BTreeMap::new();
    for context in &registry.contexts {
        for registration in &context.registrations {
            let Some(item) = hooks.get(registration.item_id.as_str()) else {
                continue;
            };
            let key = (item.id.clone(), context.project.clone());
            if !projects.contains(&context.project) {
                continue;
            }
            out.hook_checks.insert(key.clone(), false);
            if !registration.enabled {
                out.hook_checks.insert(key, true);
                continue;
            }
            if !matches!(registration.trust, HookTrust::Trusted | HookTrust::Managed)
                || !matches!(registration.handler, HookHandler::Command)
            {
                continue;
            }
            // Require a current, exact command declaration even when the native host expanded it.
            let Some(source_script) = scripts.get(item.id.as_str()) else {
                continue;
            };
            let script = if registration.source == "plugin" {
                native_scripts.get(&(context.project.as_str(), registration.native_key.as_str()))
            } else {
                source_script.as_ref()
            };
            let Some(script) = script else {
                continue;
            };
            let cache_key = (
                context.project.clone(),
                script.path.clone(),
                script.node_entry,
            );
            let status = *checks.entry(cache_key).or_insert_with(|| {
                let status = target_status(
                    Path::new(&context.project),
                    &script.path,
                    Some("file"),
                    roots,
                );
                if status != "referenceTargetMissing" || !script.node_entry {
                    return status;
                }
                // Default Node entry resolution can append these extensions, even to a name with a suffix.
                if [".js", ".json", ".node"].iter().any(|suffix| {
                    target_status(
                        Path::new(&context.project),
                        &format!("{}{suffix}", script.path),
                        Some("file"),
                        roots,
                    ) != "referenceTargetMissing"
                }) {
                    "hookEntryResolutionUnknown"
                } else {
                    status
                }
            });
            if !matches!(status, "present" | "referenceTargetMissing") {
                continue;
            }
            out.hook_checks.insert(key.clone(), true);
            if status == "present" {
                continue;
            }
            let finding = Finding {
                rule: "hookTarget".into(),
                status: "failed".into(),
                observed: None,
                threshold: None,
                evidence_codes: vec!["referenceTargetMissing".into()],
                basis: Some("effectiveTrustedEnabledHookRegistry".into()),
                evidence: Some(StaticEvidence {
                    method: "codex-0.160.0/shlex-2.0.1/static-script-v1".into(),
                    applicability: "nativeHookProject".into(),
                    declaration_hash: None,
                    relation_id: None,
                    direction: None,
                    transform: None,
                    relation: None,
                    versions: vec![FileVersion {
                        item_id: item.id.clone(),
                        path: item.path.clone(),
                        content_hash: item.content_hash.clone(),
                    }],
                    positions: vec![],
                    references: vec![],
                    hook: Some(HookTargetEvidence {
                        project: context.project.clone(),
                        native_key: registration.native_key.clone(),
                        registration_hash: registration.registration_hash.clone(),
                        host_version: registry.native_version.clone().unwrap_or_default(),
                        trust: registration.trust.clone(),
                        target: script.path.clone(),
                        status: status.into(),
                    }),
                }),
            };
            if !out.push(&item.id, finding) {
                out.hook_checks.insert(key, false);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod plugin_tests;
#[cfg(all(test, unix))]
mod tests;
