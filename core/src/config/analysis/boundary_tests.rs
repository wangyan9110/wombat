use super::*;
use std::sync::Arc;
#[test]
fn forced_hash_bucket_collisions_still_compare_raw_bytes() {
    let mut buckets = vec![];
    assert_eq!(exact_bucket(&mut buckets, "中文 A。\r\n"), 0);
    assert_eq!(exact_bucket(&mut buckets, "中文 a。\r\n"), 1);
    assert_eq!(exact_bucket(&mut buckets, "中文 A。\n"), 2);
    assert_eq!(exact_bucket(&mut buckets, "中文 A。\r\n"), 0);
    assert_eq!(buckets.len(), 3);
}
#[test]
fn skill_body_positions_exclude_yaml_and_preserve_source_offsets() {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let path = root.join("skills/check/SKILL.md");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text = "---\nname: check\ndescription: Synthetic description\n---\n\n保留完整正文。\n\n保留完整正文。\n";
    fs::write(&path, text).unwrap();
    let source = crate::adapters::contract::SourceInstance {
        id: "synthetic".into(),
        agent_kind: "codex".into(),
        root: root.to_string_lossy().into(),
    };
    let inventory = crate::config::scan::scan(&[source], &[], "now");
    let result = analyze(&inventory.items, &[]);
    assert_eq!(result.findings.len(), 1);
    let e = result.findings.values().next().unwrap()[0]
        .evidence
        .as_ref()
        .unwrap();
    assert_eq!(e.positions[0].start_line, 6);
    for p in &e.positions {
        assert_eq!(&text[p.start_byte..p.end_byte], "保留完整正文。\n");
    }
}
#[test]
fn long_headings_are_shared_and_truncated_groups_are_not_complete() {
    let text = format!(
        "# {}\n\n{}",
        "标".repeat(100_000),
        "完整段落。\n\n".repeat(5000)
    );
    let parsed = blocks(&text);
    assert_eq!(parsed.len(), 5000);
    assert!(Arc::ptr_eq(&parsed[0].context, &parsed[4999].context));
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let items = super::tests::files(&root, &[("AGENTS.md", &text)]);
    let result = analyze(&items, &[root.to_string_lossy().into()]);
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.code == "staticAnalysisResourceLimited")
    );
    assert!(
        !result
            .assessed
            .contains(&items.iter().find(|i| i.kind == Kind::Rule).unwrap().id)
    );
}
#[test]
#[ignore = "release resource benchmark; run explicitly with fixed synthetic corpus"]
fn fixed_corpus_resource_probe() {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let path = root.join("AGENTS.md");
    let mut text = String::new();
    for n in 0..4000 {
        text.push_str(&format!("完整合成指令组 {}。保留中文与 A。\n\n", n % 100));
    }
    fs::write(&path, &text).unwrap();
    let source = crate::adapters::contract::SourceInstance {
        id: "synthetic".into(),
        agent_kind: "codex".into(),
        root: root.to_string_lossy().into(),
    };
    let started = std::time::Instant::now();
    let inventory = crate::config::scan::scan(&[source], &[], "now");
    let inventory_ms = started.elapsed().as_secs_f64() * 1000.;
    let start = std::time::Instant::now();
    let analysis = analyze(&inventory.items, &[]);
    let analysis_ms = start.elapsed().as_secs_f64() * 1000.;
    let findings = analysis.findings.values().flatten().collect::<Vec<_>>();
    assert_eq!(findings.len(), 100);
    assert_eq!(
        findings
            .iter()
            .map(|f| f.evidence.as_ref().unwrap().positions.len())
            .sum::<usize>(),
        4000
    );
    assert!(analysis.issues.is_empty());
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    println!(
        "{{\"corpusBytes\":{},\"blocks\":4000,\"groups\":100,\"inventoryMs\":{},\"analysisMs\":{},\"metadataBytes\":{},\"sourceWrites\":0}}",
        text.len(),
        inventory_ms,
        analysis_ms,
        serde_json::to_vec(&analysis.findings).unwrap().len()
    );
}
