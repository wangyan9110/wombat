use super::*;
#[test]
fn applied_thread_settings_supply_model_and_effort_until_turn_context() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/settings.jsonl",
        &[
            meta("t"),
            json!({"type":"event_msg","timestamp":"2026-09-28T23:59:01Z","payload":{"type":"thread_settings_applied","thread_id":"t","thread_settings":{"model":"gpt-6-sol","model_provider_id":"openai","reasoning_effort":"high"}}}),
            direct("t", "u", "before", "2026-09-29T00:00:01Z", 100, 60, 10),
            context("u", "gpt-6-astra", "xhigh"),
            direct("t", "u", "after", "2026-09-29T00:00:02Z", 100, 60, 10),
        ],
    );
    let result = collect(dir.path());
    let before = result
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("before"))
        .unwrap();
    assert_eq!(before.model.raw.as_deref(), Some("gpt-6-sol"));
    assert_eq!(before.model.provider.as_deref(), Some("openai"));
    assert_eq!(before.reasoning_effort.as_deref(), Some("high"));
    let after = result
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("after"))
        .unwrap();
    assert_eq!(after.model.raw.as_deref(), Some("gpt-6-astra"));
    assert_eq!(after.reasoning_effort.as_deref(), Some("xhigh"));
}

#[test]
fn response_identity_not_equal_counts_deduplicates_copies() {
    let dir = tempfile::tempdir().unwrap();
    let first = direct("t", "u", "r1", "2026-09-29T00:00:01Z", 100, 60, 10);
    let second = direct("t", "u", "r2", "2026-09-29T00:00:02Z", 100, 60, 10);
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            first.clone(),
            second,
        ],
    );
    write(
        dir.path(),
        "archived_sessions/copy.jsonl",
        &[meta("t"), context("u", "gpt-5.4", "high"), first],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 2);
    assert_eq!(
        result
            .measurements
            .iter()
            .map(|v| v.tokens.total.unwrap())
            .sum::<u64>(),
        220
    );
    assert!(
        result
            .measurements
            .iter()
            .all(|v| v.tokens.input == Some(40) && v.tokens.reasoning == Some(2))
    );
    assert_eq!(result.threads.len(), 1);
    assert_eq!(result.turns.len(), 1);
    assert_eq!(
        result
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some("r1"))
            .unwrap()
            .evidence
            .len(),
        2
    );
}

#[test]
fn legacy_refresh_delta_reset_and_bad_boundary_do_not_reuse_context() {
    let dir = tempfile::tempdir().unwrap();
    let first = legacy(
        counts(100, 60, 10),
        Some(counts(100, 60, 10)),
        "2026-09-29T00:00:01Z",
    );
    let path = write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            first.clone(),
            first,
            legacy(counts(200, 100, 30), None, "2026-09-29T00:00:02Z"),
            legacy(
                counts(20, 0, 3),
                Some(counts(20, 0, 3)),
                "2026-09-29T00:00:03Z",
            ),
        ],
    );
    use std::io::Write;
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file, "{{invalid").unwrap();
    writeln!(
        file,
        "{}",
        direct("t", "v", "r3", "2026-09-29T00:00:04Z", 30, 0, 4)
    )
    .unwrap();
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 4);
    assert_eq!(
        result
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        287
    );
    let interval = result
        .measurements
        .iter()
        .find(|m| m.grain.as_ref() == "interval")
        .unwrap();
    assert_eq!(interval.tokens.input, Some(60));
    assert_eq!(interval.tokens.output, Some(20));
    assert!(!interval.request_scoped);
    assert!(
        result
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some("r3"))
            .unwrap()
            .model
            .raw
            .is_none()
    );
    assert!(result.issues.iter().any(|i| i.code == "counterReset"));
    assert!(result.issues.iter().any(|i| i.code == "invalidRecord"));
}

#[test]
fn source_namespaces_and_archive_activity_ignore_filename_date() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    for root in [a.path(), b.path()] {
        write(
            root,
            "archived_sessions/2001/01/01/a.jsonl",
            &[
                meta("same"),
                direct(
                    "same",
                    "turn",
                    "response",
                    "2026-09-29T00:00:01Z",
                    100,
                    60,
                    10,
                ),
            ],
        );
    }
    let result = crate::adapters::collect(
        &DiscoveryRequest {
            roots: vec![a.path().into(), b.path().into(), a.path().join("sessions")],
        },
        &RunContext::default(),
    );
    assert_eq!(result.sources.len(), 2);
    assert_eq!(result.threads.len(), 2);
    assert_eq!(result.measurements.len(), 2);
    assert_ne!(result.measurements[0].id, result.measurements[1].id);
    assert!(
        result
            .measurements
            .iter()
            .all(|m| m.timestamp.as_deref() == Some("2026-09-29T00:00:01.000000000Z"))
    );
}

#[test]
fn exact_fork_replay_is_excluded_but_independent_same_counts_stay() {
    let dir = tempfile::tempdir().unwrap();
    let inherited = legacy(
        counts(100, 60, 10),
        Some(counts(100, 60, 10)),
        "2026-09-29T00:00:01Z",
    );
    write(
        dir.path(),
        "sessions/parent.jsonl",
        &[
            meta("parent"),
            context("u", "gpt-5.4", "high"),
            inherited.clone(),
        ],
    );
    let mut child = meta("child");
    child["payload"]["forked_from_id"] = json!("parent");
    write(
        dir.path(),
        "sessions/child.jsonl",
        &[
            child,
            context("u", "gpt-5.4", "high"),
            inherited,
            legacy(
                counts(200, 120, 20),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:01:01Z",
            ),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 2);
    assert_eq!(
        result
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        220
    );
}

#[test]
fn tools_merge_by_call_identity_and_never_store_arguments_or_outputs() {
    let dir = tempfile::tempdir().unwrap();
    let rows = vec![
        meta("t"),
        context("u", "gpt-5.4", "high"),
        json!({"type":"response_item","timestamp":"2026-09-29T00:00:01Z","payload":{"type":"function_call","name":"mcp__docs__search","call_id":"call","arguments":"{\"query\":\"SECRET_ARGUMENT\"}"}}),
        json!({"type":"response_item","timestamp":"2026-09-29T00:00:02Z","payload":{"type":"function_call_output","call_id":"call","output":{"isError":true,"content":"SECRET_OUTPUT"}}}),
        json!({"type":"event_msg","timestamp":"2026-09-29T00:00:02Z","payload":{"type":"item_completed","thread_id":"t","turn_id":"u","item":{"type":"mcpToolCall","id":"call","call_id":"call","server":"docs","tool":"search","result":{"isError":true,"content":"SECRET_RESULT"}}}}),
        json!({"type":"response_item","timestamp":"2026-09-29T00:00:03Z","payload":{"type":"function_call","name":"read_file","call_id":"skill","arguments":"{\"path\":\"/synthetic/skill/SKILL.md\"}"}}),
    ];
    write(dir.path(), "sessions/a.jsonl", &rows);
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 2);
    let tool = result
        .operations
        .iter()
        .find(|o| o.call_id.as_deref() == Some("call"))
        .unwrap();
    assert_eq!(tool.status.as_ref(), "failed");
    assert_eq!(tool.evidence.len(), 3);
    assert_eq!(tool.server.as_deref(), Some("docs"));
    assert!(
        result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "skillRead")
    );
    let encoded = serde_json::to_string(&result).unwrap();
    assert!(!encoded.contains("SECRET"));
    assert!(!encoded.contains("arguments"));
}

#[test]
fn historical_context_conflict_and_explicit_effort_changes_are_visible() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            json!({"type":"event_msg","timestamp":"2026-09-29T00:00:00Z","payload":{"type":"thread_settings_applied","model":"gpt-5.4","reasoning_effort":"low"}}),
            direct("t", "u", "r1", "2026-09-29T00:00:01Z", 100, 0, 10),
            json!({"type":"turn_context","timestamp":"2026-09-29T00:00:02Z","payload":{"turn_id":"u","model":"gpt-5.4","effort":"high","collaboration_mode":{"settings":{"reasoning_effort":"low"}}}}),
            direct("t", "u", "r2", "2026-09-29T00:00:03Z", 100, 0, 10),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(
        result
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some("r1"))
            .unwrap()
            .reasoning_effort
            .as_deref(),
        Some("low")
    );
    assert!(
        result
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some("r2"))
            .unwrap()
            .reasoning_effort
            .is_none()
    );
    assert!(result.issues.iter().any(|i| i.code == "contextConflict"));
}

#[test]
fn owner_id_on_inherited_modern_response_preserves_parent_ownership() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/child.jsonl",
        &[
            meta("child"),
            context("new", "gpt-5.4", "high"),
            direct("parent", "old", "r", "2026-09-29T00:00:01Z", 100, 0, 10),
        ],
    );
    let result = collect(dir.path());
    let parent = result
        .threads
        .iter()
        .find(|t| t.upstream_id == "parent")
        .unwrap();
    assert_eq!(
        result.measurements[0].thread_id.as_deref(),
        Some(parent.id.as_str())
    );
    assert!(result.measurements[0].reasoning_effort.is_none());
}
