use super::*;
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
    let result = crate::adapters::collect(
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
    let result = crate::adapters::collect(
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
    let result = crate::adapters::collect(
        &DiscoveryRequest {
            roots: vec![dir.path().into()],
        },
        &context,
    );
    assert_eq!(result.sources[0].status, "failed");
    assert!(result.issues.iter().any(|i| i.code == "resourceLimit"));
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
    assert_eq!(result.measurements[0].time_precision.as_ref(), "second");
    assert_eq!(result.measurements[1].response_id.as_deref(), Some("half"));
    assert_eq!(
        result.measurements[1].time_precision.as_ref(),
        "millisecond"
    );
    assert_eq!(
        result.threads[0].last_activity_at.as_deref(),
        Some("2026-09-29T00:00:01.500000000Z")
    );
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
