use super::tests::fixture;
use super::*;
use serde_json::json;
use std::fs;

#[test]
fn native_expansion_is_contextual_ephemeral_and_requires_the_current_declaration() {
    let (dir, items, mut registry, projects) = fixture("python3 '${PLUGIN_ROOT}/private-tool.py'");
    let item = items.iter().find(|i| i.kind == Kind::Hook).unwrap();
    let roots = [fs::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned()];
    let key = "sample@test:config.toml:session_start:0:0";
    for c in &mut registry.contexts {
        let r = &mut c.registrations[0];
        r.source = "plugin".into();
        r.plugin_id = Some("sample@test".into());
        r.native_key = key.into();
    }
    let target = |n: usize| Path::new(&projects[n]).join("工具 script.py");
    fs::write(target(1), "MUST_NOT_EXECUTE").unwrap();
    let capture: crate::config::hooks::Capture = serde_json::from_value(json!({"nativeVersion":"0.160.0","checkedAt":chrono::Utc::now().to_rfc3339(),"contexts":projects.iter().enumerate().map(|(n,cwd)| json!({"cwd":cwd,"complete":true,"hooks":[{"key":key,"eventName":"sessionStart","source":"plugin","pluginId":"sample@test","sourcePath":item.path,"sourceHash":item.content_hash,"currentHash":"sha256:synthetic","enabled":true,"trustStatus":"trusted","handlerType":"command","command":format!("python3 '{}'",target(n).display())}]})).collect::<Vec<_>>()})).unwrap();
    let mut out = Analysis::default();
    analyze(
        &items,
        &projects,
        &roots,
        &registry,
        Some(&capture),
        &mut out,
    );
    assert!(out.hook_checks.values().all(|v| *v));
    assert_eq!(out.findings[&item.id].len(), 1);
    assert_eq!(
        out.findings[&item.id][0]
            .evidence
            .as_ref()
            .unwrap()
            .hook
            .as_ref()
            .unwrap()
            .target,
        target(0).to_str().unwrap()
    );
    assert!(
        !serde_json::to_string(&registry)
            .unwrap()
            .contains("private-tool")
    );
    for mode in [
        "absent",
        "hash",
        "plugin",
        "dynamic",
        "duplicate",
        "version",
        "trust",
    ] {
        let mut bad = capture.clone();
        let h = &mut bad.contexts[0].hooks[0];
        match mode {
            "absent" => h.command = None,
            "hash" => h.current_hash = "changed".into(),
            "plugin" => h.plugin_id = Some("other@test".into()),
            "dynamic" => h.command = Some("python3 '${FILE}'".into()),
            "duplicate" => {
                let duplicate = h.clone();
                bad.contexts[0].hooks.push(duplicate);
            }
            "version" => bad.native_version = Some("999.0.0".into()),
            "trust" => h.trust_status = HookTrust::Untrusted,
            _ => unreachable!(),
        }
        let mut uncertain = Analysis::default();
        analyze(
            &items,
            &projects,
            &roots,
            &registry,
            Some(&bad),
            &mut uncertain,
        );
        assert!(uncertain.findings.is_empty(), "{mode}");
        assert!(
            !uncertain.hook_checks[&(item.id.clone(), projects[0].clone())],
            "{mode}"
        );
    }
    fs::write(&item.path, "changed after capture").unwrap();
    let mut changed = Analysis::default();
    analyze(
        &items,
        &projects,
        &roots,
        &registry,
        Some(&capture),
        &mut changed,
    );
    assert!(changed.findings.is_empty());
    assert!(changed.hook_checks.values().all(|v| !v));
}
