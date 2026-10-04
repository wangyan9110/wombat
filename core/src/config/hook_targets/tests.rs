use super::*;
use crate::{adapters::contract::SourceInstance, config::scan};
use std::fs;
pub(super) fn fixture(command: &str) -> (tempfile::TempDir, Vec<Item>, HookRegistry, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let projects: Vec<_> = ["one", "two"]
        .iter()
        .map(|name| {
            let path = root.join(name);
            fs::create_dir(&path).unwrap();
            path.to_str().unwrap().into()
        })
        .collect();
    let path = source.join("config.toml");
    fs::write(
        &path,
        format!(
            "[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype='command'\ncommand={}\n",
            serde_json::to_string(command).unwrap()
        ),
    )
    .unwrap();
    let items = scan::scan(
        &[SourceInstance {
            id: "source".into(),
            agent_kind: "codex".into(),
            root: source.to_str().unwrap().into(),
        }],
        &projects,
        "2026-10-04T00:00:00Z",
    )
    .items;
    let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    let registry = HookRegistry {
        native_version: Some("0.160.0".into()),
        checked_at: None,
        status: HookRegistryStatus::Observed,
        contexts: projects
            .iter()
            .map(|project| HookContext {
                project: project.clone(),
                complete: true,
                registrations: vec![HookRegistration {
                    plugin_id: None,
                    item_id: item.id.clone(),
                    native_key: format!("{}:session_start:0:0", path.display()),
                    content_hash: item.content_hash.clone(),
                    registration_hash: "sha256:synthetic".into(),
                    enabled: true,
                    trust: HookTrust::Trusted,
                    handler: HookHandler::Command,
                    source: "user".into(),
                }],
            })
            .collect(),
    };
    (dir, items, registry, projects)
}
#[test]
fn target_checks_are_project_specific_and_existing_is_not_execution_success() {
    let (dir, items, registry, projects) = fixture("python3 'tool space.py'");
    fs::write(
        Path::new(&projects[1]).join("tool space.py"),
        "MUST_NOT_EXECUTE",
    )
    .unwrap();
    let mut out = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut out,
    );
    let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    assert_eq!(out.findings[&item.id].len(), 1);
    assert_eq!(
        out.findings[&item.id][0]
            .evidence
            .as_ref()
            .unwrap()
            .hook
            .as_ref()
            .unwrap()
            .project,
        projects[0]
    );
    assert!(out.hook_checks.values().all(|complete| *complete));
    assert!(out.complete_finding(&item.id, &out.findings[&item.id][0]));
    fs::remove_file(Path::new(&projects[1]).join("tool space.py")).unwrap();
    let mut missing = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut missing,
    );
    assert_eq!(missing.findings[&item.id].len(), 2);
}
#[test]
fn disabled_is_explicit_but_untrusted_modified_omitted_and_dynamic_stay_unknown() {
    for state in [HookTrust::Untrusted, HookTrust::Modified] {
        let (dir, items, mut registry, projects) = fixture("python3 missing.py");
        registry.contexts[0].registrations[0].trust = state;
        registry.contexts[1].registrations[0].enabled = false;
        let mut out = Analysis::default();
        analyze(
            &items,
            &projects,
            &[dunce::canonicalize(dir.path())
                .unwrap()
                .to_string_lossy()
                .into_owned()],
            &registry,
            None,
            &mut out,
        );
        let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
        assert_eq!(
            out.hook_checks.get(&(item.id.clone(), projects[0].clone())),
            Some(&false)
        );
        assert_eq!(
            out.hook_checks.get(&(item.id.clone(), projects[1].clone())),
            Some(&true)
        );
        assert!(out.findings.is_empty());
        registry.contexts.clear();
        let mut absent = Analysis::default();
        analyze(
            &items,
            &projects,
            &[dunce::canonicalize(dir.path())
                .unwrap()
                .to_string_lossy()
                .into_owned()],
            &registry,
            None,
            &mut absent,
        );
        assert!(absent.hook_checks.values().all(|v| !v));
    }
    let (dir, items, registry, projects) = fixture("python3 $FILE");
    let mut out = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut out,
    );
    assert!(out.findings.is_empty());
    assert!(out.hook_checks.values().all(|v| !v));
}
#[test]
fn node_extension_fallback_changed_declaration_and_scope_escape_prevent_missing_claims() {
    let (dir, items, registry, projects) = fixture("node ./entry.js");
    fs::write(
        Path::new(&projects[0]).join("entry.js.js"),
        "MUST_NOT_EXECUTE",
    )
    .unwrap();
    let mut out = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut out,
    );
    let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    assert_eq!(out.findings[&item.id].len(), 1);
    assert_eq!(
        out.hook_checks.get(&(item.id.clone(), projects[0].clone())),
        Some(&false)
    );
    fs::write(&item.path, "changed after inventory").unwrap();
    let mut changed = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut changed,
    );
    assert!(changed.findings.is_empty());
    assert!(changed.hook_checks.values().all(|v| !v));
    let (dir, items, registry, projects) = fixture("python3 ../../outside.py");
    let mut allowed = projects.clone();
    allowed.push(
        dunce::canonicalize(dir.path().join("source"))
            .unwrap()
            .to_string_lossy()
            .into_owned(),
    );
    let mut escaped = Analysis::default();
    analyze(&items, &projects, &allowed, &registry, None, &mut escaped);
    assert!(escaped.findings.is_empty());
    assert!(escaped.hook_checks.values().all(|v| !v));
}

#[test]
fn incomplete_registry_siblings_do_not_discard_a_bound_positive_reference_fact() {
    let (dir, items, mut registry, projects) = fixture("python3 missing.py");
    registry.contexts[0].complete = false;
    registry.contexts[1].registrations.clear();
    let mut out = Analysis::default();
    analyze(
        &items,
        &projects,
        &[dunce::canonicalize(dir.path())
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        &registry,
        None,
        &mut out,
    );
    let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    assert_eq!(out.findings[&item.id].len(), 1);
    assert_eq!(
        out.hook_checks.get(&(item.id.clone(), projects[0].clone())),
        Some(&true)
    );
    assert_ne!(
        out.hook_checks.get(&(item.id.clone(), projects[1].clone())),
        Some(&true)
    );
}

#[test]
fn filesystem_order_does_not_treat_file_parent_or_trailing_slash_as_a_valid_script() {
    let (dir, items, registry, projects) = fixture("python3 not-a-directory/../present.py");
    for project in &projects {
        fs::write(Path::new(project).join("not-a-directory"), "file").unwrap();
        fs::write(Path::new(project).join("present.py"), "MUST_NOT_EXECUTE").unwrap();
    }
    let roots = [dunce::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned()];
    let mut out = Analysis::default();
    analyze(&items, &projects, &roots, &registry, None, &mut out);
    assert!(out.findings.is_empty());
    assert!(out.hook_checks.values().all(|complete| !complete));
    for target in [
        "present.py/",
        "present.py/.",
        "not-a-directory/../present.py",
    ] {
        assert_eq!(
            target_status(Path::new(&projects[0]), target, Some("file"), &roots),
            "referenceTargetTypeMismatch"
        );
    }
}
