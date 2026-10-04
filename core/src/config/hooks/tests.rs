use super::*;
use crate::adapters::contract::SourceInstance;
use serde_json::json;
fn fixture() -> (tempfile::TempDir, Vec<Item>, Capture) {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let path = root.join("config.toml");
    std::fs::write(&path, "[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype='command'\ncommand='echo SYNTHETIC'\n").unwrap();
    let source = SourceInstance {
        id: "s".into(),
        agent_kind: "codex".into(),
        root: root.to_str().unwrap().into(),
    };
    let items = scan::scan(&[source], &[], &Utc::now().to_rfc3339()).items;
    let hook = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    let capture = serde_json::from_value(json!({"nativeVersion":"0.160.0","checkedAt":Utc::now().to_rfc3339(),"contexts":[{"cwd":"/allowed","complete":true,"hooks":[{"key":format!("{}:session_start:0:0",path.display()),"sourcePath":path,"sourceHash":hook.content_hash,"eventName":"sessionStart","currentHash":"sha256:synthetic","enabled":true,"trustStatus":"trusted","handlerType":"command","source":"user"}]}]})).unwrap();
    (dir, items, capture)
}
#[test]
fn registry_is_bound_to_authorized_project_and_exact_current_file() {
    let (_dir, items, mut capture) = fixture();
    let result = bind(Some(&capture), &items, &["/allowed".into()]);
    assert!(matches!(result.status, HookRegistryStatus::Observed));
    assert_eq!(result.contexts[0].registrations.len(), 1);
    assert!(matches!(
        result.contexts[0].registrations[0].trust,
        HookTrust::Trusted
    ));
    assert!(
        bind(Some(&capture), &items, &["/other".into()])
            .contexts
            .is_empty()
    );
    capture.contexts[0].hooks[0].source_hash = "changed".into();
    let changed = bind(Some(&capture), &items, &["/allowed".into()]);
    assert!(matches!(changed.status, HookRegistryStatus::Partial));
    assert!(changed.contexts[0].registrations.is_empty());
}
#[test]
fn registry_keeps_project_trust_and_enablement_separate_and_omission_unknown() {
    let (_dir, items, mut capture) = fixture();
    let mut second = capture.contexts[0].clone();
    second.cwd = "/second".into();
    second.hooks[0].enabled = false;
    second.hooks[0].trust_status = HookTrust::Modified;
    capture.contexts.push(second);
    let result = bind(
        Some(&capture),
        &items,
        &["/allowed".into(), "/second".into(), "/missing".into()],
    );
    assert!(matches!(result.status, HookRegistryStatus::Partial));
    assert!(result.contexts[0].registrations[0].enabled);
    assert!(!result.contexts[1].registrations[0].enabled);
    assert!(matches!(
        result.contexts[1].registrations[0].trust,
        HookTrust::Modified
    ));
    assert!(items.iter().all(|i| i.usage_count.is_none()));
}
#[test]
fn registry_rejects_stale_future_unknown_version_duplicate_and_plugin_bindings() {
    let (_dir, items, capture) = fixture();
    for at in [
        Utc::now() - chrono::Duration::seconds(61),
        Utc::now() + chrono::Duration::seconds(1),
    ] {
        let mut bad = capture.clone();
        bad.checked_at = Some(at.to_rfc3339());
        assert!(
            bind(Some(&bad), &items, &["/allowed".into()])
                .contexts
                .is_empty()
        );
    }
    let mut bad = capture.clone();
    bad.native_version = Some("999.0.0".into());
    assert!(
        bind(Some(&bad), &items, &["/allowed".into()])
            .contexts
            .is_empty()
    );
    for key in [
        "plugin@test:hooks/hooks.json:session_start:0:0",
        "unrelated:session_start:0:0",
    ] {
        let mut bad = capture.clone();
        bad.contexts[0].hooks[0].key = key.into();
        assert!(
            bind(Some(&bad), &items, &["/allowed".into()]).contexts[0]
                .registrations
                .is_empty()
        );
    }
    let mut duplicate = items.clone();
    duplicate.extend(items);
    assert!(
        bind(Some(&capture), &duplicate, &["/allowed".into()]).contexts[0]
            .registrations
            .is_empty()
    );
}

#[test]
fn plugin_identity_requires_consistent_metadata_and_exact_package_relative_path() {
    let (dir, mut items, mut capture) = fixture();
    let hook = &mut capture.contexts[0].hooks[0];
    hook.source = "plugin".into();
    hook.plugin_id = Some("sample.tools@test".into());
    hook.source_path = dir
        .path()
        .join("selected/plugin/hooks/声明.json")
        .to_string_lossy()
        .into_owned();
    hook.key = "sample.tools@test:hooks/声明.json:session_start:0:0".into();
    items
        .iter_mut()
        .find(|i| i.kind == Kind::Hook)
        .unwrap()
        .path
        .clone_from(&hook.source_path);
    assert!(matches!(
        bind(Some(&capture), &items, &["/allowed".into()]).status,
        HookRegistryStatus::Observed
    ));
    for (id, key, source) in [
        (
            None,
            "sample.tools@test:hooks/声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("other@test"),
            "sample.tools@test:hooks/声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:other/声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:hooks/../hooks/声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:/hooks/声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:hooks//声明.json:session_start:0:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:hooks/声明.json:session_start:00:0",
            "plugin",
        ),
        (
            Some("sample.tools@test"),
            "sample.tools@test:hooks/声明.json:session_start:0:0",
            "user",
        ),
        (
            Some("../sample@test"),
            "../sample@test:hooks/声明.json:session_start:0:0",
            "plugin",
        ),
    ] {
        let mut bad = capture.clone();
        let h = &mut bad.contexts[0].hooks[0];
        h.plugin_id = id.map(str::to_owned);
        h.key = key.into();
        h.source = source.into();
        let result = bind(Some(&bad), &items, &["/allowed".into()]);
        assert!(
            matches!(result.status, HookRegistryStatus::Partial),
            "{key}"
        );
        assert!(result.contexts[0].registrations.is_empty());
    }
}
