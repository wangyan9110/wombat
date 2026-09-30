use super::*;
use serde_json::{Value, json};

fn meta(id: &str) -> Value {
    json!({"type":"session_meta","timestamp":"2026-09-28T23:59:00Z","payload":{"id":id,"cwd":"/synthetic/project"}})
}
fn context(turn: &str, model: &str, effort: &str) -> Value {
    json!({"type":"turn_context","timestamp":"2026-09-28T23:59:01Z","payload":{"turn_id":turn,"model":model,"effort":effort}})
}
fn counts(input: u64, cache: u64, output: u64) -> Value {
    json!({"input_tokens":input,"cached_input_tokens":cache,"cache_write_input_tokens":0,"output_tokens":output,"reasoning_output_tokens":2,"total_tokens":input+output})
}
fn direct(
    thread: &str,
    turn: &str,
    response: &str,
    at: &str,
    input: u64,
    cache: u64,
    output: u64,
) -> Value {
    json!({"type":"event_msg","timestamp":at,"payload":{"type":"token_usage_record","thread_id":thread,"turn_id":turn,"response_id":response,"usage":counts(input,cache,output)}})
}
fn legacy(total: Value, last: Option<Value>, at: &str) -> Value {
    json!({"type":"event_msg","timestamp":at,"payload":{"type":"token_count","info":{"total_token_usage":total,"last_token_usage":last}}})
}
fn write(root: &Path, name: &str, rows: &[Value]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        rows.iter()
            .map(|v| v.to_string() + "\n")
            .collect::<String>(),
    )
    .unwrap();
    path
}
fn collect(root: &Path) -> Collected {
    super::super::collect(
        &DiscoveryRequest {
            roots: vec![root.into()],
        },
        &RunContext::default(),
    )
}

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
        .find(|m| m.grain == "interval")
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
fn modern_ledger_excludes_matching_legacy_telemetry_and_compaction_copy() {
    let dir = tempfile::tempdir().unwrap();
    let mut row = direct("t", "u", "r1", "2026-09-29T00:00:01Z", 100, 60, 10);
    row["payload"]["thread_token_usage"] = counts(100, 60, 10);
    let compact = json!({"type":"compacted","timestamp":"2026-09-29T00:00:03Z","payload":{"compaction_response_id":"r1","latest_token_usage_record":row["payload"].clone()}});
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            legacy(
                counts(100, 60, 10),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:01Z",
            ),
            row,
            compact,
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 1);
    assert_eq!(result.measurements[0].tokens.total, Some(110));
    assert_eq!(result.operations.len(), 1);
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
    let result = super::super::collect(
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
        json!({"type":"event_msg","timestamp":"2026-09-29T00:00:02Z","payload":{"type":"item_completed","thread_id":"t","turn_id":"u","item":{"type":"mcpToolCall","id":"call","server":"docs","tool":"search","result":{"isError":true,"content":"SECRET_RESULT"}}}}),
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
    assert_eq!(tool.status, "failed");
    assert_eq!(tool.evidence.len(), 3);
    assert_eq!(tool.server.as_deref(), Some("docs"));
    assert!(result.operations.iter().any(|o| o.kind == "skillRead"));
    let encoded = serde_json::to_string(&result).unwrap();
    assert!(!encoded.contains("SECRET"));
    assert!(!encoded.contains("arguments"));
}

#[test]
fn unknown_conflicting_and_zero_fields_remain_distinct() {
    let dir = tempfile::tempdir().unwrap();
    let mut unknown = direct("t", "u", "unknown", "2026-09-29T00:00:01Z", 100, 60, 10);
    unknown["payload"]["usage"] = json!({"total_tokens":110});
    let mut conflict = direct("t", "u", "conflict", "2026-09-29T00:00:02Z", 100, 60, 10);
    let first = conflict.clone();
    conflict["payload"]["turn_id"] = json!("other");
    conflict["payload"]["usage"]["total_tokens"] = json!(111);
    let mut zero = direct("t", "u", "zero", "2026-09-29T00:00:03Z", 0, 0, 0);
    zero["payload"]["usage"]["reasoning_output_tokens"] = json!(0);
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[meta("t"), unknown, first, conflict, zero],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 3);
    let unknown = result
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("unknown"))
        .unwrap();
    assert_eq!(unknown.tokens.total, Some(110));
    assert!(unknown.tokens.input.is_none());
    let conflict = result
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("conflict"))
        .unwrap();
    assert!(conflict.turn_id.is_none());
    assert!(conflict.tokens.total.is_none());
    assert_eq!(
        result
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some("zero"))
            .unwrap()
            .tokens
            .total,
        Some(0)
    );
}

#[test]
fn large_line_is_fully_skipped_without_losing_next_event_and_tail_is_reported() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            json!({"type":"response_item","timestamp":"2026-09-29T00:00:01Z","payload":{"type":"message","content":"私有正文".repeat(300_000)}}),
            direct("t", "u", "r", "2026-09-29T00:00:02Z", 100, 60, 10),
        ],
    );
    use std::io::Write;
    write!(
        fs::OpenOptions::new().append(true).open(path).unwrap(),
        "{{\"type\":"
    )
    .unwrap();
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 1);
    assert_eq!(result.measurements[0].tokens.total, Some(110));
    assert!(result.issues.iter().any(|i| i.code == "incompleteTail"));
    assert_eq!(result.sources[0].status, "partial");
    assert!(!serde_json::to_string(&result).unwrap().contains("私有正文"));
}

#[test]
fn source_failure_isolated_and_cancellation_reported() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    write(
        a.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            direct("t", "u", "r", "2026-09-29T00:00:02Z", 100, 60, 10),
        ],
    );
    fs::write(b.path().join("sessions"), "not a directory").unwrap();
    let result = super::super::collect(
        &DiscoveryRequest {
            roots: vec![a.path().into(), b.path().into()],
        },
        &RunContext::default(),
    );
    assert_eq!(result.measurements.len(), 1);
    assert!(result.sources.iter().any(|s| !s.issues.is_empty()));
    let context = RunContext::default();
    context
        .cancelled
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let result = super::super::collect(
        &DiscoveryRequest {
            roots: vec![a.path().into()],
        },
        &context,
    );
    assert!(result.measurements.is_empty());
}

#[test]
fn native_titles_are_latest_sanitized_and_never_derived_from_messages() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "sessions/a.jsonl", &[meta("t")]);
    write(
        dir.path(),
        "session_index.jsonl",
        &[
            json!({"id":"t","thread_name":"最新\u{1b}[31m标题","updated_at":"2026-09-29T00:00:00Z"}),
            json!({"id":"t","thread_name":"旧标题","updated_at":"2026-09-28T00:00:00Z"}),
        ],
    );
    assert_eq!(
        collect(dir.path()).threads[0].title.as_deref(),
        Some("最新标题")
    );
}

#[test]
fn modern_without_totals_is_primary_in_same_turn_but_preserves_older_turn() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("old", "gpt-5.4", "low"),
            legacy(
                counts(100, 60, 10),
                Some(counts(100, 60, 10)),
                "2026-09-28T23:59:02Z",
            ),
            context("new", "gpt-5.4", "high"),
            legacy(
                counts(200, 120, 20),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:01Z",
            ),
            direct("t", "new", "r", "2026-09-29T00:00:01Z", 100, 60, 10),
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
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.code == "usageCoverageUnknown")
    );
}

#[test]
fn stale_last_usage_cannot_replace_cumulative_delta_and_gap_cannot_rebill_history() {
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
            first,
            legacy(
                counts(300, 120, 40),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:02Z",
            ),
        ],
    );
    use std::io::Write;
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file, "{{invalid").unwrap();
    writeln!(
        file,
        "{}",
        legacy(
            counts(400, 180, 50),
            Some(counts(100, 60, 10)),
            "2026-09-29T00:00:03Z"
        )
    )
    .unwrap();
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 3);
    assert_eq!(
        result
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        450
    );
    assert!(
        result
            .measurements
            .iter()
            .any(|m| m.tokens.total == Some(230) && !m.request_scoped)
    );
    assert!(result.issues.iter().any(|i| i.code == "counterGap"));
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

#[test]
fn explicit_missing_root_has_failure_receipt_and_resource_caps_are_public() {
    let dir = tempfile::tempdir().unwrap();
    let result = collect(&dir.path().join("missing"));
    assert_eq!(result.sources[0].status, "notFound");
    assert!(result.issues.iter().any(|i| i.code == "sourceUnreadable"));
    write(dir.path(), "sessions/a.jsonl", &[meta("t")]);
    let context = RunContext {
        max_bytes: 1,
        ..RunContext::default()
    };
    let result = super::super::collect(
        &DiscoveryRequest {
            roots: vec![dir.path().into()],
        },
        &context,
    );
    assert_eq!(result.sources[0].status, "failed");
    assert!(result.issues.iter().any(|i| i.code == "resourceLimit"));
}

#[test]
fn existing_identity_registry_migrates_without_writing_or_reusing_replaced_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let path = write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 0, 10),
        ],
    );
    let bytes = fs::read(&path).unwrap();
    let metadata = fs::metadata(&path).unwrap();
    #[cfg(unix)]
    let physical = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{:?}",
            metadata.dev(),
            metadata.ino(),
            metadata.created().ok()
        )
    };
    #[cfg(not(unix))]
    let physical = format!(
        "{}:{:?}",
        fs::canonicalize(&path).unwrap().to_string_lossy(),
        metadata.created().ok()
    );
    let registry = json!({"version":1,"environmentId":"env_known","objects":{},"files":{physical:{"size":bytes.len(),"contentHash":format!("{:x}",Sha256::digest(&bytes)),"generation":"file_known"}}});
    let source = SourceInstance {
        id: "inst_known".into(),
        agent_kind: "codex".into(),
        root: dir.path().to_string_lossy().into_owned(),
    };
    let mut facts = Facts {
        identities: Some(serde_json::from_value(registry.clone()).unwrap()),
        ..Facts::default()
    };
    let mut report = SourceReport {
        source: source.clone(),
        adapter_version: VERSION.into(),
        source_versions: vec![],
        capabilities: Capabilities::default(),
        status: "complete".into(),
        files_read: 0,
        bytes_read: 0,
        issues: vec![],
    };
    read_file(
        &path,
        &source,
        &RunContext::default(),
        &mut facts,
        &mut report,
    );
    facts.apply_identities();
    let expected = format!("ses_{:x}", Sha256::digest("env_known:file_known:codex:t"));
    assert_eq!(facts.threads.values().next().unwrap().id, expected);
    assert_eq!(
        facts
            .measurements
            .values()
            .next()
            .unwrap()
            .measurement
            .thread_id
            .as_deref(),
        Some(expected.as_str())
    );
    fs::write(
        &path,
        bytes
            .iter()
            .map(|b| if *b == b't' { b'x' } else { *b })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let mut changed = Facts {
        identities: Some(serde_json::from_value(registry).unwrap()),
        ..Facts::default()
    };
    read_file(
        &path,
        &source,
        &RunContext::default(),
        &mut changed,
        &mut report,
    );
    assert!(changed.migrated.is_empty());
}

#[test]
fn legacy_cache_write_zero_is_protocol_specific_and_modern_missing_is_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let mut legacy_counts = counts(100, 60, 10);
    legacy_counts
        .as_object_mut()
        .unwrap()
        .remove("cache_write_input_tokens");
    let mut modern = direct("t", "new", "r", "2026-09-29T00:00:02Z", 100, 60, 10);
    modern["payload"]["usage"]
        .as_object_mut()
        .unwrap()
        .remove("cache_write_input_tokens");
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("old", "gpt-5.4", "high"),
            legacy(
                legacy_counts.clone(),
                Some(legacy_counts),
                "2026-09-29T00:00:01Z",
            ),
            context("new", "gpt-5.4", "high"),
            modern,
        ],
    );
    let result = collect(dir.path());
    let old = result
        .measurements
        .iter()
        .find(|m| m.response_id.is_none())
        .unwrap();
    let new = result
        .measurements
        .iter()
        .find(|m| m.response_id.is_some())
        .unwrap();
    assert_eq!(old.tokens.input, Some(40));
    assert_eq!(old.tokens.cache_create, Some(0));
    assert!(new.tokens.input.is_none());
    assert!(new.tokens.cache_create.is_none());
}

#[test]
fn partial_overlap_keeps_direct_and_exposes_unresolved_legacy_coverage() {
    let dir = tempfile::tempdir().unwrap();
    let mut modern = direct("t", "u", "r", "2026-09-29T00:00:02Z", 40, 0, 10);
    modern["payload"]["thread_token_usage"] = counts(90, 0, 10);
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            legacy(counts(90, 0, 10), None, "2026-09-29T00:00:01Z"),
            modern,
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 1);
    assert_eq!(result.measurements[0].tokens.total, Some(50));
    assert!(result.issues.iter().any(|i| i.code == "usageOverlap"));
    assert_eq!(result.sources[0].status, "partial");
}

#[test]
fn turn_context_does_not_leak_across_new_turn_without_history_settings() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("old", "gpt-5.4", "high"),
            direct("t", "new", "r", "2026-09-29T00:00:01Z", 100, 0, 10),
        ],
    );
    let result = collect(dir.path());
    assert!(result.measurements[0].model.raw.is_none());
    assert!(result.measurements[0].reasoning_effort.is_none());
}

#[test]
fn fractional_timestamps_sort_after_whole_second_without_inventing_source_precision() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            direct("t", "u", "half", "2026-09-29T00:00:01.5Z", 100, 0, 10),
            direct("t", "u", "whole", "2026-09-29T00:00:01Z", 100, 0, 10),
        ],
    );
    let mut result = collect(dir.path());
    result
        .measurements
        .sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    assert_eq!(result.measurements[0].response_id.as_deref(), Some("whole"));
    assert_eq!(result.measurements[0].time_precision, "second");
    assert_eq!(result.measurements[1].response_id.as_deref(), Some("half"));
    assert_eq!(result.measurements[1].time_precision, "millisecond");
    assert_eq!(
        result.threads[0].last_activity_at.as_deref(),
        Some("2026-09-29T00:00:01.500000000Z")
    );
}

#[test]
fn duplicate_missing_context_does_not_erase_known_fields_and_conflicts_stay_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let row = direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10);
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[meta("t"), context("u", "gpt-5.4", "high"), row.clone()],
    );
    write(
        dir.path(),
        "archived_sessions/copy.jsonl",
        &[meta("t"), row.clone()],
    );
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 1);
    assert_eq!(result.measurements[0].model.raw.as_deref(), Some("gpt-5.4"));
    assert_eq!(
        result.measurements[0].reasoning_effort.as_deref(),
        Some("high")
    );
    assert!(!result.issues.iter().any(|i| i.code == "modelConflict"));
    let mut conflict = row.clone();
    conflict["payload"]["usage"]["total_tokens"] = json!(111);
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[meta("t"), row.clone(), conflict, row],
    );
    let result = collect(dir.path());
    assert!(result.measurements[0].tokens.total.is_none());
}

#[test]
fn entirely_invalid_source_fails_and_source_versions_are_observed_not_assumed() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("sessions")).unwrap();
    fs::write(dir.path().join("sessions/a.jsonl"), "{invalid\n{invalid\n").unwrap();
    assert_eq!(collect(dir.path()).sources[0].status, "failed");
    let mut session = meta("t");
    session["payload"]["cli_version"] = json!("synthetic-version");
    write(dir.path(), "sessions/a.jsonl", &[session]);
    let result = collect(dir.path());
    assert_eq!(result.sources[0].source_versions, vec!["synthetic-version"]);
}

#[test]
fn live_checkpoint_restart_tail_retraction_and_full_replay_agree() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/live.jsonl",
        &[
            meta("live"),
            context("u", "gpt-5.4", "high"),
            legacy(
                counts(100, 60, 10),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:01Z",
            ),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let sync = |verify| {
        let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
        let tx = db.transaction().unwrap();
        let result = incremental::sync(&tx, &source, verify).unwrap();
        tx.commit().unwrap();
        result
    };
    assert_eq!(sync(false).unwrap().measurements[0].tokens.total, Some(110));
    assert!(sync(false).is_none(), "unchanged source must not reparse");
    let row = direct("live", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10).to_string();
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(row.as_bytes()).unwrap();
    let partial = sync(false).unwrap();
    assert_eq!(partial.measurements.len(), 1);
    assert_eq!(partial.sources[0].issues[0].code, "incompleteTail");
    file.write_all(b"\n").unwrap();
    let live = sync(false).unwrap();
    let full = collect(root.path());
    assert_eq!(
        serde_json::to_value(&live.measurements).unwrap(),
        serde_json::to_value(&full.measurements).unwrap()
    );
    assert_eq!(
        live.measurements.len(),
        1,
        "late direct record replaces legacy delta"
    );
    assert_eq!(live.sources[0].bytes_read, row.len() as u64 + 1);
    assert!(
        !live.sources[0]
            .issues
            .iter()
            .any(|i| i.code == "incompleteTail")
    );
    // Parser context survives another process, including cumulative counters and model.
    for i in 2..=6 {
        let row = direct(
            "live",
            "u",
            &format!("r{i}"),
            "2026-09-29T00:00:02Z",
            100,
            60,
            10,
        )
        .to_string()
            + "\n";
        file.write_all(row.as_bytes()).unwrap();
        let live = sync(false).unwrap();
        assert_eq!(live.measurements.len(), i);
        assert_eq!(live.sources[0].bytes_read, row.len() as u64);
        assert_eq!(
            live.measurements
                .iter()
                .map(|m| m.tokens.total.unwrap())
                .sum::<u64>(),
            i as u64 * 110
        );
        assert!(
            live.measurements
                .iter()
                .all(|m| m.model.raw.as_deref() == Some("gpt-5.4"))
        );
    }
    let verified = sync(true).unwrap();
    assert_eq!(
        serde_json::to_value(verified.measurements).unwrap(),
        serde_json::to_value(collect(root.path()).measurements).unwrap()
    );
}

#[test]
fn live_transaction_rollback_truncate_missing_and_body_privacy() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let rows = [
        meta("t"),
        context("u", "gpt-5.4", "high"),
        direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10),
        serde_json::json!({"type":"response_item","payload":{"type":"message","content":[{"type":"input_text","text":"PRIVATE_SYNTHETIC_BODY_MUST_NOT_PERSIST"}]}}),
    ];
    let path = write(root.path(), "sessions/a.jsonl", &rows);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    {
        let tx = db.transaction().unwrap();
        incremental::sync(&tx, &source, false).unwrap(); /* Simulated crash: no commit. */
    }
    assert_eq!(
        incremental::sync(&db, &source, false)
            .unwrap()
            .unwrap()
            .measurements
            .len(),
        1
    );
    let text: String = db
        .prepare("SELECT group_concat(payload) FROM kv")
        .unwrap()
        .query_row([], |r| r.get(0))
        .unwrap();
    assert!(!text.contains("PRIVATE_SYNTHETIC_BODY_MUST_NOT_PERSIST"));
    write(
        root.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            direct("t", "u", "new", "2026-09-29T00:00:01Z", 200, 60, 20),
        ],
    );
    let replaced = incremental::sync(&db, &source, false).unwrap().unwrap();
    assert_eq!(replaced.measurements.len(), 1);
    assert_eq!(replaced.measurements[0].tokens.total, Some(220));
    fs::remove_file(path).unwrap();
    let missing = incremental::sync(&db, &source, false).unwrap().unwrap();
    assert_eq!(missing.measurements[0].tokens.total, Some(220));
    assert!(missing.issues.iter().any(|i| i.code == "sourceMissing"));
}

#[test]
fn indexed_direct_coverage_preserves_owner_and_half_open_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/base.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            direct("t", "u", "base", "2026-09-29T00:00:01Z", 100, 60, 10),
        ],
    );
    let collected = collect(dir.path());
    let base = &collected.measurements[0];
    // Independent coverage expectations: adjacent ranges form a union; endpoint
    // contact has no overlap; another owner never contributes coverage.
    for (ranges, legacy_range, other_owner, removed, partial) in [
        (vec![(0, 50), (50, 100)], (0, 100), false, true, false),
        (vec![(0, 49), (50, 100)], (0, 100), false, true, true),
        (vec![(100, 110)], (0, 100), false, false, false),
        (vec![(0, 20)], (20, 40), false, false, false),
        (vec![(10, 50)], (20, 40), false, true, false),
        (vec![(0, 100)], (0, 100), true, false, false),
    ] {
        let mut facts = Facts::default();
        let mut report = collected.sources[0].clone();
        report.issues.clear();
        for (i, (start, end)) in ranges.iter().enumerate() {
            let mut m = base.as_ref().clone();
            m.id = format!("direct-{i}");
            if other_owner {
                m.thread_id = Some("other-owner".into());
            }
            facts.measurements.insert(
                m.id.clone(),
                Candidate {
                    measurement: m.into(),
                    direct: true,
                    cumulative: Some(*end),
                    interval_start: Some(*start),
                    fingerprint: String::new(),
                },
            );
        }
        let mut legacy = base.as_ref().clone();
        legacy.id = "legacy".into();
        facts.measurements.insert(
            legacy.id.clone(),
            Candidate {
                measurement: legacy.into(),
                direct: false,
                cumulative: Some(legacy_range.1),
                interval_start: Some(legacy_range.0),
                fingerprint: String::new(),
            },
        );
        facts.reconcile_direct(&mut report);
        assert_eq!(!facts.measurements.contains_key("legacy"), removed);
        assert_eq!(
            report.issues.iter().any(|i| i.code == "usageOverlap"),
            partial
        );
    }
}

#[test]
fn live_cached_operations_keep_old_views_and_restart_equivalence() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/live.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10),
            json!({"type":"response_item","payload":{"type":"function_call","name":"read_file","call_id":"call","arguments":"PRIVATE_ARGUMENT"}}),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut cache = incremental::Cache::default();
    let synced = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    let (first, dirty) = (synced.collected, synced.operations);
    assert!(dirty.is_none());
    let old_status = first.operations[0].status.clone();
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(
        file,
        "{}",
        direct("t", "u", "r2", "2026-09-29T00:00:02Z", 100, 60, 10)
    )
    .unwrap();
    let synced = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    let (second, dirty) = (synced.collected, synced.operations);
    assert!(dirty.unwrap().is_empty());
    assert!(Arc::ptr_eq(&first.operations[0], &second.operations[0]));
    writeln!(file,"{}",json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"call","output":{"isError":true,"content":"PRIVATE_OUTPUT"}}})).unwrap();
    let synced = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    let (third, dirty) = (synced.collected, synced.operations);
    assert_eq!(dirty.unwrap().len(), 1);
    assert_eq!(third.operations[0].status, "failed");
    assert_eq!(first.operations[0].status, old_status);
    drop(cache);
    writeln!(
        file,
        "{}",
        direct("t", "u", "r3", "2026-09-29T00:00:03Z", 100, 60, 10)
    )
    .unwrap();
    let mut restored = incremental::Cache::default();
    restored.seed(third.measurements.clone(), third.operations.clone());
    let restart = incremental::sync_cached(&db, &source, false, &mut restored)
        .unwrap()
        .unwrap()
        .collected;
    assert!(Arc::ptr_eq(&third.operations[0], &restart.operations[0]));
    let previous = third
        .measurements
        .iter()
        .find(|r| r.response_id.as_deref() == Some("r"))
        .unwrap();
    let resumed = restart
        .measurements
        .iter()
        .find(|r| r.id == previous.id)
        .unwrap();
    assert!(Arc::ptr_eq(previous, resumed));
    let full = collect(root.path());
    assert_eq!(
        serde_json::to_value(&restart.operations).unwrap(),
        serde_json::to_value(&full.operations).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&restart.measurements).unwrap(),
        serde_json::to_value(&full.measurements).unwrap()
    );
    assert_eq!(
        restart
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        330
    );
}

#[test]
fn live_projection_delta_retracts_late_legacy_and_preserves_prior_facts() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/delta.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            legacy(
                counts(100, 60, 10),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:01Z",
            ),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut cache = incremental::Cache::default();
    let first = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    assert!(first.measurements.is_none());
    let old = first.collected.measurements[0].clone();
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(
        file,
        "{}",
        direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10)
    )
    .unwrap();
    let second = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    let delta = second.measurements.unwrap();
    assert_eq!(delta.remove, vec![old.id.clone()]);
    assert_eq!(delta.upsert.len(), 1);
    assert_eq!(second.collected.measurements.len(), 1);
    let retained = second.collected.measurements[0].clone();
    writeln!(
        file,
        "{}",
        direct("t", "u", "r", "2026-09-29T00:00:01Z", 200, 60, 10)
    )
    .unwrap();
    let third = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    let delta = third.measurements.unwrap();
    assert!(delta.remove.is_empty());
    assert_eq!(delta.upsert.len(), 1);
    assert_eq!(
        delta.upsert[0].tokens.total, None,
        "conflicting evidence remains unknown"
    );
    assert_eq!(retained.tokens.total, Some(110));
    assert_eq!(old.tokens.total, Some(110));
}
