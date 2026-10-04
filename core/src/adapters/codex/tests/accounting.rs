use super::*;
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
