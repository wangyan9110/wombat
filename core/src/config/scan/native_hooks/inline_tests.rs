use super::*;
use serde_json::json;

#[test]
fn inline_single_and_array_bind_exact_native_positions_without_unlisted_content() {
    let dir = tempfile::tempdir().unwrap();
    let home = fs::canonicalize(dir.path()).unwrap();
    let path = home.join("package/.codex-plugin/plugin.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let source = SourceInstance {
        id: "source".into(),
        agent_kind: "codex".into(),
        root: home.to_string_lossy().into_owned(),
    };
    let handler = r#"{ "type": "command", "command": "PRIVATE_NEVER_EXECUTE" }"#;
    let doc = format!(
        r#"{{"hooks":{{"SessionStart":[{{"hooks":[{handler},{{"type":"command","command":"UNLISTED"}}]}}]}}}}"#
    );
    for array in [false, true] {
        let text = if array {
            format!(r#"{{"name":"sample","hooks":[{{"hooks":{{"Stop":[]}}}},{doc},{doc}]}}"#)
        } else {
            format!(r#"{{"name":"sample","hooks":{doc}}}"#)
        };
        fs::write(&path, &text).unwrap();
        let index = usize::from(array);
        let key = format!("sample@test:plugin.json#hooks[{index}]:session_start:0:0");
        let now = chrono::Utc::now().to_rfc3339();
        let hook = json!({"key":key,"pluginId":"sample@test","source":"plugin","sourcePath":path,"sourceHash":crate::hash(&text),"currentHash":"sha256:synthetic","eventName":"sessionStart","enabled":true,"trustStatus":"trusted","handlerType":"command"});
        let capture: hooks::Capture = serde_json::from_value(json!({"nativeVersion":"0.160.0","checkedAt":now,"contexts":[{"cwd":"/a","complete":true,"hooks":[hook]},{"cwd":"/b","complete":true,"hooks":[hook]}]})).unwrap();
        let mut inventory = Inventory::default();
        append_selected(
            &mut inventory,
            &capture,
            &source,
            &home,
            &["/a".into(), "/b".into()],
            &now,
        );
        assert_eq!(inventory.used, text.len() as u64);
        assert_eq!(inventory.items.len(), 1);
        let row = &inventory.items[0];
        let pointer = if array {
            "/hooks/1/hooks/SessionStart/0/hooks/0"
        } else {
            "/hooks/hooks/SessionStart/0/hooks/0"
        };
        assert_eq!(row.native_key.as_deref(), Some(pointer));
        assert_eq!(row.bytes, Some(handler.len() as u64));
        assert_eq!(row.authorized_projects, ["/a", "/b"]);
        let registry = hooks::bind(
            Some(&capture),
            &inventory.items,
            &["/a".into(), "/b".into()],
        );
        assert!(matches!(registry.status, HookRegistryStatus::Observed));
        assert!(
            registry
                .contexts
                .iter()
                .all(|c| c.registrations[0].native_key == key)
        );
        assert!(
            !serde_json::to_string(&inventory.items)
                .unwrap()
                .contains("PRIVATE_NEVER_EXECUTE")
        );
        for bad_key in [
            "sample@test:plugin.json#hooks[01]:session_start:0:0",
            "sample@test:plugin.json#hooks[9]:session_start:0:0",
            "other@test:plugin.json#hooks[0]:session_start:0:0",
        ] {
            let mut bad = capture.clone();
            for c in &mut bad.contexts {
                c.hooks[0].key = bad_key.into();
            }
            let result = hooks::bind(Some(&bad), &inventory.items, &["/a".into(), "/b".into()]);
            assert!(matches!(result.status, HookRegistryStatus::Partial));
            assert!(result.contexts.iter().all(|c| c.registrations.is_empty()));
        }
        let mut changed = capture.clone();
        changed.contexts[0].hooks[0].source_hash = "different-file".into();
        assert!(
            hooks::bind(Some(&changed), &inventory.items, &["/a".into()]).contexts[0]
                .registrations
                .is_empty()
        );
    }
}
