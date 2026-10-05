//! Synthetic native source truth for field-local availability and canonical replay.
use super::*;
use crate::session_events::Payload as SafePayload;
use std::io::Write;

fn observation(response: &str, usage: Value) -> Value {
    json!({"type":"event_msg","timestamp":"2026-09-29T00:00:01Z","payload":{"type":"token_usage_record","thread_id":"t","turn_id":"u","response_id":response,"usage":usage}})
}
fn run(rows: &[Value]) -> Collected {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "sessions/tokens.jsonl", rows);
    collect(root.path())
}
fn valid(usage: u64) -> Value {
    json!({"input_tokens":100,"cached_input_tokens":30,"cache_write_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":2,"total_tokens":usage})
}
fn check(collected: &Collected) {
    for measurement in &collected.measurements {
        validate_token_observations(&measurement.tokens, &measurement.token_unavailable_reasons)
            .unwrap();
    }
}

#[test]
fn malformed_optional_field_does_not_drop_other_native_counts_and_zero_is_covered() {
    for (field, invalid) in [
        ("cache_write_input_tokens", json!(-1)),
        ("reasoning_output_tokens", json!("invalid")),
        ("total_tokens", json!(MAX_SAFE_INTEGER + 1)),
    ] {
        let mut usage = valid(110);
        usage[field] = invalid;
        let collected = run(&[meta("t"), observation("r", usage)]);
        assert_eq!(collected.measurements.len(), 1);
        let measurement = &collected.measurements[0];
        assert_eq!(measurement.tokens.raw_input, Some(100));
        assert_eq!(measurement.tokens.output, Some(10));
        assert_eq!(measurement.tokens.cache_read, Some(30));
        let missing = match field {
            "cache_write_input_tokens" => TokenField::CacheCreate,
            "reasoning_output_tokens" => TokenField::Reasoning,
            _ => TokenField::Total,
        };
        assert_eq!(
            *measurement.token_unavailable_reasons.get(missing),
            Some(TokenUnavailableReason::Invalid)
        );
        check(&collected);
    }
    let zero = run(&[
        meta("t"),
        observation(
            "zero",
            json!({"input_tokens":0,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":0}),
        ),
    ]);
    for field in TokenField::ALL {
        assert_eq!(zero.measurements[0].tokens.get(field), Some(0));
        assert_eq!(
            *zero.measurements[0].token_unavailable_reasons.get(field),
            None
        );
    }
    check(&zero);
}

#[test]
fn explicit_empty_usage_is_a_missing_measurement_but_absent_usage_is_not_fabricated() {
    let absent =
        json!({"type":"event_msg","payload":{"type":"token_usage_record","response_id":"absent"}});
    let collected = run(&[meta("t"), absent, observation("empty", json!({}))]);
    assert_eq!(collected.measurements.len(), 1);
    assert_eq!(
        collected.measurements[0].response_id.as_deref(),
        Some("empty")
    );
    for field in TokenField::ALL {
        assert_eq!(
            *collected.measurements[0]
                .token_unavailable_reasons
                .get(field),
            Some(TokenUnavailableReason::Missing)
        );
    }
    check(&collected);
}

#[test]
fn partial_evidence_can_be_completed_and_source_invalid_reason_survives_replay() {
    let mut malformed = valid(110);
    malformed["cache_write_input_tokens"] = json!("invalid");
    for rows in [
        [malformed.clone(), valid(110)],
        [valid(110), malformed.clone()],
    ] {
        let collected = run(&[
            meta("t"),
            observation("r", rows[0].clone()),
            observation("r", rows[1].clone()),
        ]);
        assert_eq!(collected.measurements.len(), 1);
        assert_eq!(collected.measurements[0].tokens.input, Some(70));
        assert_eq!(
            collected.measurements[0].token_unavailable_reasons.input,
            None
        );
        assert!(collected.events.iter().any(|event|matches!(event.payload(),SafePayload::Measurement{value,..} if value.token_unavailable_reasons.cache_create==Some(TokenUnavailableReason::Invalid))));
        let (replayed, _) = super::event_projection::replay(&collected);
        assert_eq!(replayed.measurements, collected.measurements);
        check(&collected);
    }
}

#[test]
fn conflicting_native_total_stays_unknown_even_when_categories_and_later_total_are_known() {
    for totals in [[110, 111, 110], [111, 110, 111]] {
        let collected = run(&[
            meta("t"),
            observation("r", valid(totals[0])),
            observation("r", valid(totals[1])),
            observation("r", valid(totals[2])),
        ]);
        let row = &collected.measurements[0];
        assert_eq!(row.tokens.total, None);
        assert_eq!(
            row.token_unavailable_reasons.total,
            Some(TokenUnavailableReason::Conflicting)
        );
        assert_eq!(row.tokens.raw_input, Some(100));
        assert_eq!(row.tokens.output, Some(10));
        let (replayed, _) = super::event_projection::replay(&collected);
        assert_eq!(replayed.measurements, collected.measurements);
        check(&collected);
    }
}

#[test]
fn legacy_missing_baseline_and_reset_have_explicit_interval_reasons() {
    let first = json!({"output_tokens":10,"total_tokens":10});
    let second =
        json!({"input_tokens":100,"cached_input_tokens":0,"output_tokens":20,"total_tokens":120});
    let collected = run(&[
        meta("t"),
        legacy(first, None, "2026-09-29T00:00:01Z"),
        legacy(second, None, "2026-09-29T00:00:02Z"),
    ]);
    let second = collected
        .measurements
        .iter()
        .find(|row| row.tokens.total == Some(110))
        .unwrap();
    assert_eq!(second.tokens.raw_input, None);
    assert_eq!(
        second.token_unavailable_reasons.raw_input,
        Some(TokenUnavailableReason::Indeterminate)
    );
    assert_eq!(second.tokens.output, Some(10));
    assert_eq!(second.tokens.cache_create, Some(0));
    assert_eq!(
        second.token_unavailable_reasons.reasoning,
        Some(TokenUnavailableReason::Missing)
    );
    check(&collected);
    let reset = run(&[
        meta("t"),
        legacy(counts(100, 30, 10), None, "2026-09-29T00:00:01Z"),
        legacy(counts(10, 0, 2), None, "2026-09-29T00:00:02Z"),
    ]);
    let unknown = reset
        .measurements
        .iter()
        .find(|row| row.tokens.total.is_none())
        .unwrap();
    for field in TokenField::ALL {
        assert_eq!(
            *unknown.token_unavailable_reasons.get(field),
            Some(TokenUnavailableReason::Indeterminate)
        );
    }
    check(&reset);
}

#[test]
fn append_and_restart_preserve_partial_baseline_reasons_and_canonical_conflicts() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let mut response = observation("r", valid(110));
    response["payload"]["thread_id"] = json!("other");
    let path = write(
        root.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            legacy(
                json!({"output_tokens":10,"total_tokens":10}),
                None,
                "2026-09-29T00:00:01Z",
            ),
            response.clone(),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    incremental::sync_cached(&db, &source, false, &mut incremental::Cache::default())
        .unwrap()
        .unwrap();
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file,"{}",legacy(json!({"input_tokens":100,"cached_input_tokens":0,"output_tokens":20,"total_tokens":120}),None,"2026-09-29T00:00:02Z")).unwrap();
    response["payload"]["usage"] = valid(111);
    writeln!(file, "{}", response).unwrap();
    let restart = incremental::sync_cached(&db, &source, false, &mut incremental::Cache::default())
        .unwrap()
        .unwrap()
        .collected;
    assert_eq!(restart.measurements, collect(root.path()).measurements);
    let legacy = restart
        .measurements
        .iter()
        .find(|row| row.response_id.is_none() && row.tokens.total == Some(110))
        .unwrap();
    assert_eq!(
        legacy.token_unavailable_reasons.raw_input,
        Some(TokenUnavailableReason::Indeterminate)
    );
    let response = restart
        .measurements
        .iter()
        .find(|row| row.response_id.as_deref() == Some("r"))
        .unwrap();
    assert_eq!(
        response.token_unavailable_reasons.total,
        Some(TokenUnavailableReason::Conflicting)
    );
    check(&restart);
}

#[test]
fn safe_event_roundtrip_retains_field_reasons_and_rejects_illegal_pairs() {
    use crate::session_events::Event;
    let mut usage = valid(110);
    usage["cache_write_input_tokens"] = json!("invalid");
    let collected = run(&[meta("t"), observation("r", usage)]);
    let event = collected
        .events
        .iter()
        .find(|event| matches!(event.payload(), SafePayload::Measurement { .. }))
        .unwrap();
    let stored = serde_json::to_value(event).unwrap();
    let restored: Event = serde_json::from_value(stored.clone()).unwrap();
    assert_eq!(serde_json::to_value(&restored).unwrap(), stored);
    let SafePayload::Measurement { value, .. } = restored.payload() else {
        unreachable!()
    };
    assert_eq!(value.tokens.raw_input, Some(100));
    assert_eq!(value.token_unavailable_reasons.raw_input, None);
    assert_eq!(value.tokens.cache_create, None);
    assert_eq!(
        value.token_unavailable_reasons.cache_create,
        Some(TokenUnavailableReason::Invalid)
    );
    for (field, reason) in [("rawInput", json!("missing")), ("cacheCreate", Value::Null)] {
        let mut invalid = stored.clone();
        invalid["payload"]["value"]["tokenUnavailableReasons"][field] = reason;
        assert!(serde_json::from_value::<Event>(invalid).is_err());
    }
    let mut missing = stored;
    missing["payload"]["value"]
        .as_object_mut()
        .unwrap()
        .remove("tokenUnavailableReasons");
    assert!(serde_json::from_value::<Event>(missing).is_err());
}

#[test]
fn native_input_conflict_cannot_be_repaired_by_complete_category_breakdowns() {
    let collected = run(&[
        meta("t"),
        observation("r", json!({"input_tokens":100})),
        observation("r", json!({"input_tokens":101})),
        observation("r", valid(110)),
    ]);
    let row = &collected.measurements[0];
    assert_eq!(row.tokens.raw_input, None);
    assert_eq!(
        row.token_unavailable_reasons.raw_input,
        Some(TokenUnavailableReason::Conflicting)
    );
    assert_eq!(row.tokens.input, Some(70));
    assert_eq!(row.tokens.cache_read, Some(30));
    assert_eq!(row.tokens.cache_create, Some(0));
    let (replayed, _) = super::event_projection::replay(&collected);
    assert_eq!(replayed.measurements, collected.measurements);
    check(&collected);
}

#[test]
fn malformed_legacy_cache_write_cannot_turn_into_protocol_zero() {
    let collected = run(&[
        meta("t"),
        legacy(
            json!({"input_tokens":100,"cached_input_tokens":30,"cache_write_input_tokens":false,"output_tokens":10,"total_tokens":110}),
            None,
            "2026-09-29T00:00:01Z",
        ),
    ]);
    let row = &collected.measurements[0];
    assert_eq!(row.tokens.cache_create, None);
    assert_eq!(
        row.token_unavailable_reasons.cache_create,
        Some(TokenUnavailableReason::Invalid)
    );
    assert_eq!(row.tokens.input, None);
    assert_eq!(
        row.token_unavailable_reasons.input,
        Some(TokenUnavailableReason::Invalid)
    );
    assert_eq!(row.tokens.raw_input, Some(100));
    assert_eq!(row.tokens.total, Some(110));
    check(&collected);
}

#[test]
fn explicit_null_is_invalid_and_cannot_authorize_legacy_protocol_zero() {
    let direct = run(&[
        meta("t"),
        observation(
            "r",
            json!({"input_tokens":100,"cached_input_tokens":null,"cache_write_input_tokens":0,"output_tokens":10,"total_tokens":110}),
        ),
    ]);
    let row = &direct.measurements[0];
    assert_eq!(row.tokens.raw_input, Some(100));
    assert_eq!(row.tokens.output, Some(10));
    assert_eq!(row.tokens.cache_read, None);
    assert_eq!(
        row.token_unavailable_reasons.cache_read,
        Some(TokenUnavailableReason::Invalid)
    );
    check(&direct);
    for cache_write in [Some(Value::Null), None] {
        let mut usage = json!({"input_tokens":100,"cached_input_tokens":30,"output_tokens":10,"total_tokens":110});
        if let Some(value) = &cache_write {
            usage["cache_write_input_tokens"] = value.clone();
        }
        let collected = run(&[meta("t"), legacy(usage, None, "2026-09-29T00:00:01Z")]);
        let row = &collected.measurements[0];
        assert_eq!(row.tokens.cache_create, cache_write.is_none().then_some(0));
        assert_eq!(row.tokens.input, cache_write.is_none().then_some(70));
        assert_eq!(
            row.token_unavailable_reasons.cache_create,
            cache_write
                .is_some()
                .then_some(TokenUnavailableReason::Invalid)
        );
        check(&collected);
    }
}

#[test]
fn missing_invalid_or_discontinuous_baseline_never_becomes_a_zero_interval_origin() {
    for previous_total in [None, Some(json!("invalid"))] {
        let mut first = json!({"input_tokens":100,"cached_input_tokens":0,"output_tokens":10});
        if let Some(total) = previous_total {
            first["total_tokens"] = total;
        }
        let collected = run(&[
            meta("t"),
            legacy(first, None, "2026-09-29T00:00:01Z"),
            legacy(
                json!({"input_tokens":110,"cached_input_tokens":0,"output_tokens":10,"total_tokens":120}),
                None,
                "2026-09-29T00:00:02Z",
            ),
        ]);
        let observed = collected
            .events
            .iter()
            .find_map(|event| match event.payload() {
                SafePayload::Measurement {
                    value,
                    cumulative: Some(120),
                    interval_start,
                    ..
                } => Some((value, interval_start)),
                _ => None,
            })
            .unwrap();
        assert_eq!(*observed.1, None);
        assert_eq!(observed.0.tokens.total, None);
        assert_eq!(
            observed.0.token_unavailable_reasons.total,
            Some(TokenUnavailableReason::Indeterminate)
        );
        assert_eq!(observed.0.tokens.raw_input, Some(10));
        check(&collected);
    }
    for last in [
        None,
        Some(
            json!({"input_tokens":10,"cached_input_tokens":0,"output_tokens":0,"total_tokens":10}),
        ),
    ] {
        let collected = run(&[
            meta("t"),
            json!("invalid complete source row"),
            legacy(
                json!({"input_tokens":110,"cached_input_tokens":0,"output_tokens":10,"total_tokens":120}),
                last.clone(),
                "2026-09-29T00:00:02Z",
            ),
        ]);
        let (row, interval_start) = collected
            .events
            .iter()
            .find_map(|event| match event.payload() {
                SafePayload::Measurement {
                    value,
                    interval_start,
                    ..
                } => Some((value, interval_start)),
                _ => None,
            })
            .unwrap();
        assert_eq!(*interval_start, None);
        assert_eq!(row.tokens.total, last.as_ref().map(|_| 10));
        if last.is_none() {
            assert_eq!(
                row.token_unavailable_reasons.total,
                Some(TokenUnavailableReason::Indeterminate)
            );
        }
        check(&collected);
    }
    let initial = run(&[
        meta("t"),
        legacy(counts(100, 30, 10), None, "2026-09-29T00:00:01Z"),
    ]);
    assert!(initial.events.iter().any(|event| matches!(
        event.payload(),
        SafePayload::Measurement {
            interval_start: Some(0),
            ..
        }
    )));
    let last_only = run(&[
        meta("t"),
        legacy(Value::Null, Some(counts(10, 0, 2)), "2026-09-29T00:00:01Z"),
        legacy(counts(100, 30, 10), None, "2026-09-29T00:00:02Z"),
    ]);
    let (row, start) = last_only
        .events
        .iter()
        .find_map(|event| match event.payload() {
            SafePayload::Measurement {
                value,
                cumulative: Some(110),
                interval_start,
                ..
            } => Some((value, interval_start)),
            _ => None,
        })
        .unwrap();
    assert_eq!(*start, None);
    assert_eq!(row.tokens.total, None);
    assert_eq!(
        row.token_unavailable_reasons.total,
        Some(TokenUnavailableReason::Indeterminate)
    );
    check(&last_only);
}

#[test]
fn direct_coverage_cannot_retract_known_parts_of_an_interval_with_unknown_origin() {
    let mut first = counts(100, 0, 10);
    first["total_tokens"] = json!("invalid");
    let mut response = direct("t", "u", "response", "2026-09-29T00:00:03Z", 110, 0, 10);
    response["payload"]["thread_token_usage"] = json!({"total_tokens":120});
    let collected = run(&[
        meta("t"),
        context("u", "model", "low"),
        legacy(first, None, "2026-09-29T00:00:01Z"),
        legacy(counts(110, 0, 10), None, "2026-09-29T00:00:02Z"),
        response,
    ]);
    let retained = collected
        .measurements
        .iter()
        .find(|row| row.response_id.is_none() && row.tokens.raw_input == Some(10))
        .unwrap();
    assert_eq!(retained.tokens.total, None);
    assert_eq!(
        retained.token_unavailable_reasons.total,
        Some(TokenUnavailableReason::Indeterminate)
    );
    assert!(
        collected
            .measurements
            .iter()
            .any(|row| row.response_id.as_deref() == Some("response"))
    );
    check(&collected);
}
