use super::*;
use crate::session_events::{Position, Time};

fn measurement(id: &str, input: Option<u64>, scoped: bool) -> Measurement {
    serde_json::from_value(serde_json::json!({
        "id": id, "agentKind":"codex", "sourceInstanceId":"source",
        "threadId":"thread", "turnId":"turn", "grain":"response",
        "timePrecision":"millisecond", "model":{"raw":"model"},
        "reasoningEffort":"high", "tokens":{"rawInput":input,"input":10,"cacheRead":90},
        "requestScoped":scoped,"sequence":0,"evidence":[]
    }))
    .unwrap()
}

#[test]
fn type_seven_uses_inclusive_input_and_per_sample_windows() {
    let measurements: Vec<_> = [100, 200, 300, 400, 500]
        .iter()
        .enumerate()
        .map(|(i, value)| measurement(&i.to_string(), Some(*value), true))
        .collect();
    let result = summarize(measurements.iter().enumerate().map(|(i, value)| Candidate {
        measurement: value,
        segment_id: "s",
        window: Some(MatchedWindow {
            tokens: if i == 4 { 1000 } else { 500 },
            basis: WindowBasis::SameRecord,
        }),
    }));
    assert_eq!(result.input.p90, Some(460.0));
    assert_eq!(result.ratio.p90, Some(0.72));
    assert_eq!(result.segments[0].same_record_windows, 5);
}

#[test]
fn unknown_and_cumulative_are_not_request_samples() {
    let measurements = [
        measurement("delta", Some(100), false),
        measurement("unknown", None, true),
        measurement("zero", Some(0), true),
        measurement("over", Some(200), true),
    ];
    let result = summarize(measurements.iter().enumerate().map(|(i, value)| Candidate {
        measurement: value,
        segment_id: "s",
        window: (i == 3).then_some(MatchedWindow {
            tokens: 100,
            basis: WindowBasis::SameRecord,
        }),
    }));
    assert_eq!(result.input.samples, 2);
    assert_eq!(result.input.median, Some(100.0));
    assert_eq!(result.ratio.p90, Some(2.0));
    assert_eq!(result.segments[0].non_request_scoped, 1);
    assert_eq!(result.segments[0].missing_raw_input, 1);
    assert_eq!(result.segments[0].missing_window, 1);
    assert_eq!(result.segments[0].above_window, 1);
    assert_eq!(summarize([]).input.p90, None);
}

fn event(offset: u64, ordinal: u32, payload: Payload) -> Arc<Event> {
    Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "g".into(),
                byte_offset: offset,
                ordinal,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(Some("2026-10-04T00:00:00.000Z")).0,
            vec![],
            payload,
        )
        .unwrap(),
    )
}
fn measured(offset: u64, value: Measurement) -> Arc<Event> {
    event(
        offset,
        0,
        Payload::Measurement {
            value: Arc::new(value),
            direct: true,
            cumulative: None,
            interval_start: None,
            fingerprint: offset.to_string(),
        },
    )
}

#[test]
fn same_row_wins_and_effort_changes_reset_history() {
    let mut changed = measurement("changed", Some(200), true);
    changed.reasoning_effort = Some("low".into());
    let events = vec![
        measured(3, changed),
        measured(2, measurement("continued", Some(100), true)),
        measured(1, measurement("first", Some(100), true)),
        event(
            1,
            1,
            Payload::ContextWindow {
                model: Some("model".into()),
                tokens: 1000,
            },
        ),
    ];
    let result = summarize_events(
        &[
            Arc::new(measurement("first", Some(100), true)),
            Arc::new(measurement("continued", Some(100), true)),
            match events[0].payload() {
                Payload::Measurement { value, .. } => value.clone(),
                _ => unreachable!(),
            },
        ],
        &events,
    );
    assert_eq!(result.input.samples, 3);
    assert_eq!(result.ratio.samples, 2);
    assert_eq!(result.ratio.p90, Some(0.1));
    assert_eq!(
        result
            .segments
            .iter()
            .map(|s| s.missing_window)
            .sum::<usize>(),
        1
    );
}

#[test]
fn conflicting_windows_and_measurement_copies_do_not_invent_samples() {
    let m = measurement("copy", Some(100), true);
    let events = vec![
        measured(1, m.clone()),
        measured(2, m),
        event(
            1,
            1,
            Payload::ContextWindow {
                model: None,
                tokens: 1000,
            },
        ),
        event(
            1,
            2,
            Payload::ContextWindow {
                model: None,
                tokens: 2000,
            },
        ),
    ];
    let result = summarize_events(&[Arc::new(measurement("copy", Some(100), true))], &events);
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.ratio.samples, 0);
    assert_eq!(result.conflicting_window_records, 1);
}

#[test]
fn missing_time_unassigned_gap_and_file_boundary_break_continuation() {
    let first = measured(1, measurement("first", Some(100), true));
    let window = event(
        1,
        1,
        Payload::ContextWindow {
            model: None,
            tokens: 1000,
        },
    );
    let gap = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "g".into(),
                byte_offset: 2,
                ordinal: 0,
            },
            None,
            None,
            Time::from_source(None).0,
            vec![crate::session_events::Gap::SourcePartial],
            Payload::ContextWindow {
                model: None,
                tokens: 1000,
            },
        )
        .unwrap(),
    );
    let later = measured(3, measurement("later", Some(100), true));
    let other_file = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "other".into(),
                generation: "g".into(),
                byte_offset: 4,
                ordinal: 0,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(Some("2026-10-04T00:00:00Z")).0,
            vec![],
            Payload::Measurement {
                value: Arc::new(measurement("other", Some(100), true)),
                direct: true,
                cumulative: None,
                interval_start: None,
                fingerprint: "other".into(),
            },
        )
        .unwrap(),
    );
    let result = summarize_events(
        &["first", "later", "other"].map(|id| Arc::new(measurement(id, Some(100), true))),
        &[first, window, gap, later, other_file],
    );
    assert_eq!(result.input.samples, 3);
    assert_eq!(result.ratio.samples, 1);
}

#[test]
fn zero_window_is_unknown_ratio_but_zero_input_is_known() {
    let value = measurement("zero", Some(0), true);
    let result = summarize([Candidate {
        measurement: &value,
        segment_id: "s",
        window: Some(MatchedWindow {
            tokens: 0,
            basis: WindowBasis::SameRecord,
        }),
    }]);
    assert_eq!(result.input.p90, Some(0.0));
    assert_eq!(result.ratio.p90, None);
    assert_eq!(result.segments[0].invalid_window, 1);
}

#[test]
fn compaction_neighbors_keep_distance_and_stop_at_model_segment() {
    let mut after = measurement("after", Some(50), true);
    after.model.raw = Some("other-model".into());
    let compaction = event(
        2,
        0,
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Compaction,
            phase: crate::session_events::Phase::Completed,
            native_id: Some("compact".into()),
            duration_ms: None,
            first_token_ms: None,
        },
    );
    let result = summarize_events(
        &[
            Arc::new(measurement("before", Some(100), true)),
            Arc::new(after.clone()),
        ],
        &[
            measured(1, measurement("before", Some(100), true)),
            compaction,
            measured(3, after),
        ],
    );
    assert_eq!(result.compactions.len(), 1);
    let neighbors = &result.compactions[0];
    assert_eq!(neighbors.before.as_ref().unwrap().raw_input, 100);
    assert_eq!(neighbors.before.as_ref().unwrap().distance_ms, 0);
    assert_eq!(neighbors.after, None);
}

#[test]
fn compaction_has_both_reliable_neighbors_in_the_same_segment() {
    let compaction = event(
        2,
        0,
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Compaction,
            phase: crate::session_events::Phase::Completed,
            native_id: None,
            duration_ms: None,
            first_token_ms: None,
        },
    );
    let result = summarize_events(
        &[
            Arc::new(measurement("before", Some(100), true)),
            Arc::new(measurement("after", Some(50), true)),
        ],
        &[
            measured(1, measurement("before", Some(100), true)),
            compaction,
            measured(3, measurement("after", Some(50), true)),
        ],
    );
    assert_eq!(
        result.compactions[0]
            .before
            .as_ref()
            .unwrap()
            .measurement_id,
        "before"
    );
    assert_eq!(
        result.compactions[0].after.as_ref().unwrap().measurement_id,
        "after"
    );
}

#[test]
fn duplicate_identity_with_different_window_keeps_ratio_unknown() {
    let result = summarize_events(
        &[Arc::new(measurement("same", Some(100), true))],
        &[
            measured(1, measurement("same", Some(100), true)),
            event(
                1,
                1,
                Payload::ContextWindow {
                    model: None,
                    tokens: 1000,
                },
            ),
            measured(2, measurement("same", Some(100), true)),
            event(
                2,
                1,
                Payload::ContextWindow {
                    model: None,
                    tokens: 2000,
                },
            ),
        ],
    );
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.ratio.samples, 0);
}

fn source_meta(id: &str) -> serde_json::Value {
    serde_json::json!({"type":"session_meta","timestamp":"2026-10-04T00:00:00Z",
        "payload":{"id":id,"cwd":"/synthetic/project"}})
}

fn source_context() -> serde_json::Value {
    serde_json::json!({"type":"turn_context","timestamp":"2026-10-04T00:00:01Z",
        "payload":{"turn_id":"t","model":"model","effort":"high"}})
}

fn source_counts(input: u64) -> serde_json::Value {
    serde_json::json!({"input_tokens":input,"cached_input_tokens":40,
        "output_tokens":10,"total_tokens":input+10})
}

fn source_direct(input: u64, time: &str) -> serde_json::Value {
    serde_json::json!({"type":"event_msg","timestamp":time,"payload":{
        "type":"token_usage_record","thread_id":"parent","turn_id":"t",
        "response_id":"r","usage":source_counts(input)}})
}

fn source_legacy() -> serde_json::Value {
    serde_json::json!({"type":"event_msg","timestamp":"2026-10-04T00:00:02Z",
        "payload":{"type":"token_count","info":{"total_token_usage":source_counts(100),
            "last_token_usage":source_counts(100),"model_context_window":1000}}})
}

fn write_source(root: &std::path::Path, name: &str, rows: &[serde_json::Value]) {
    let directory = root.join("sessions");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(
        directory.join(name),
        rows.iter()
            .map(|row| row.to_string() + "\n")
            .collect::<String>(),
    )
    .unwrap();
}

fn collect_source(root: &std::path::Path) -> crate::adapters::contract::Collected {
    crate::adapters::collect(
        &crate::adapters::contract::DiscoveryRequest {
            roots: vec![root.into()],
        },
        &crate::adapters::contract::RunContext::default(),
    )
}

fn count_raw_measurements(events: &[Arc<Event>]) -> usize {
    events
        .iter()
        .filter(|event| matches!(event.payload(), Payload::Measurement { .. }))
        .count()
}

#[test]
fn real_adapter_response_copies_keep_one_input_without_evidence_conflicts() {
    let root = tempfile::tempdir().unwrap();
    write_source(
        root.path(),
        "parent.jsonl",
        &[
            source_meta("parent"),
            source_context(),
            source_direct(100, "2026-10-04T00:00:02Z"),
            source_direct(100, "2026-10-04T00:00:03Z"),
        ],
    );
    let collected = collect_source(root.path());
    assert_eq!(count_raw_measurements(&collected.events), 2);
    assert_eq!(collected.measurements.len(), 1);
    assert_eq!(collected.measurements[0].evidence.len(), 2);
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, 1);
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.input.p90, Some(100.0));
    assert_eq!(result.conflicting_measurements, 0);
}

#[test]
fn real_adapter_conflicting_response_keeps_candidate_and_unknown_input() {
    let root = tempfile::tempdir().unwrap();
    write_source(
        root.path(),
        "parent.jsonl",
        &[
            source_meta("parent"),
            source_context(),
            source_direct(100, "2026-10-04T00:00:02Z"),
            source_direct(200, "2026-10-04T00:00:03Z"),
        ],
    );
    let collected = collect_source(root.path());
    assert_eq!(collected.measurements.len(), 1);
    assert_eq!(collected.measurements[0].tokens.raw_input, None);
    assert!(
        collected
            .issues
            .iter()
            .any(|issue| issue.code == "measurementConflict")
    );
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, 1);
    assert_eq!(result.input.samples, 0);
    assert_eq!(result.conflicting_measurements, 1);
    assert_eq!(result.segments[0].missing_raw_input, 1);
}

#[test]
fn real_adapter_direct_and_legacy_reuse_accounting_reconciliation() {
    let root = tempfile::tempdir().unwrap();
    write_source(
        root.path(),
        "parent.jsonl",
        &[
            source_meta("parent"),
            source_context(),
            source_legacy(),
            source_direct(100, "2026-10-04T00:00:02Z"),
        ],
    );
    let collected = collect_source(root.path());
    assert_eq!(count_raw_measurements(&collected.events), 2);
    assert_eq!(collected.measurements.len(), 1);
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, collected.measurements.len());
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.input.p90, Some(100.0));
    assert_eq!(result.ratio.samples, 0); // a preceding window has no established effort segment
}

#[test]
fn real_adapter_fork_replay_reuses_accounting_reconciliation() {
    let root = tempfile::tempdir().unwrap();
    let rows = [source_meta("parent"), source_context(), source_legacy()];
    write_source(root.path(), "parent.jsonl", &rows);
    let mut child = source_meta("child");
    child["payload"]["forked_from_id"] = serde_json::json!("parent");
    write_source(
        root.path(),
        "child.jsonl",
        &[child, source_context(), source_legacy()],
    );
    let collected = collect_source(root.path());
    assert_eq!(count_raw_measurements(&collected.events), 2);
    assert_eq!(collected.measurements.len(), 1);
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, collected.measurements.len());
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.input.p90, Some(100.0));
    assert_eq!(result.ratio.p90, Some(0.1));
}

#[test]
fn independent_window_model_change_breaks_compaction_neighbors() {
    let measurements = [
        Arc::new(measurement("before", Some(100), true)),
        Arc::new(measurement("after", Some(50), true)),
    ];
    let result = summarize_events(
        &measurements,
        &[
            measured(1, measurements[0].as_ref().clone()),
            event(
                2,
                0,
                Payload::ContextWindow {
                    model: Some("other-model".into()),
                    tokens: 1000,
                },
            ),
            event(
                3,
                0,
                Payload::Lifecycle {
                    lifecycle: LifecycleKind::Compaction,
                    phase: crate::session_events::Phase::Completed,
                    native_id: None,
                    duration_ms: None,
                    first_token_ms: None,
                },
            ),
            measured(4, measurements[1].as_ref().clone()),
        ],
    );
    assert_eq!(result.segments.len(), 2);
    assert_eq!(result.compactions[0].before, None);
    assert_eq!(result.compactions[0].after, None);
}

#[test]
fn retained_measurement_without_events_keeps_authoritative_candidate_coverage() {
    let result = summarize_events(&[Arc::new(measurement("retained", Some(100), true))], &[]);
    assert_eq!(result.candidates, 1);
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.ratio.samples, 0);
    assert_eq!(result.segments[0].missing_window, 1);
}

#[test]
fn real_adapter_independent_window_change_does_not_pair_across_models() {
    let root = tempfile::tempdir().unwrap();
    let mut after = source_direct(50, "2026-10-04T00:00:05Z");
    after["payload"]["response_id"] = serde_json::json!("after");
    write_source(
        root.path(),
        "parent.jsonl",
        &[
            source_meta("parent"),
            source_context(),
            source_direct(100, "2026-10-04T00:00:02Z"),
            serde_json::json!({"type":"event_msg","timestamp":"2026-10-04T00:00:03Z", "payload":{
            "type":"token_count","model":"other-model","info":{"model_context_window":1000}}}),
            serde_json::json!({"type":"event_msg","timestamp":"2026-10-04T00:00:04Z", "payload":{
                "type":"item_completed", "item":{"type":"ContextCompaction","id":"compact"}}}),
            after,
        ],
    );
    let collected = collect_source(root.path());
    assert_eq!(collected.measurements.len(), 2);
    assert_eq!(count_raw_measurements(&collected.events), 2);
    assert!(
        collected
            .events
            .iter()
            .any(|event| matches!(event.payload(),
        Payload::ContextWindow { model: Some(model), .. } if model == "other-model"))
    );
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, 2);
    assert_eq!(result.input.samples, 2);
    assert_eq!(result.segments.len(), 2);
    assert_eq!(result.compactions.len(), 1);
    assert_eq!(result.compactions[0].before, None);
    assert_eq!(result.compactions[0].after, None);
}

#[test]
fn replayed_copies_cannot_establish_an_arbitrary_compaction_neighbor() {
    let value = Arc::new(measurement("same", Some(100), true));
    let result = summarize_events(
        std::slice::from_ref(&value),
        &[
            measured(1, value.as_ref().clone()),
            event(
                2,
                0,
                Payload::Lifecycle {
                    lifecycle: LifecycleKind::Compaction,
                    phase: crate::session_events::Phase::Completed,
                    native_id: None,
                    duration_ms: None,
                    first_token_ms: None,
                },
            ),
            measured(3, value.as_ref().clone()),
        ],
    );
    assert_eq!(result.candidates, 1);
    assert_eq!(result.input.samples, 1);
    assert_eq!(result.compactions[0].before, None);
    assert_eq!(result.compactions[0].after, None);
}

#[test]
fn real_adapter_cumulative_delta_stays_a_candidate_without_request_samples() {
    let root = tempfile::tempdir().unwrap();
    let mut cumulative = source_legacy();
    cumulative["payload"]["info"]["last_token_usage"] = serde_json::Value::Null;
    write_source(
        root.path(),
        "parent.jsonl",
        &[source_meta("parent"), source_context(), cumulative],
    );
    let collected = collect_source(root.path());
    assert_eq!(collected.measurements.len(), 1);
    assert_eq!(collected.measurements[0].tokens.raw_input, Some(100));
    assert!(!collected.measurements[0].request_scoped);
    let result = summarize_events(&collected.measurements, &collected.events);
    assert_eq!(result.candidates, 1);
    assert_eq!(result.input.samples, 0);
    assert_eq!(result.ratio.samples, 0);
    assert_eq!(result.segments[0].non_request_scoped, 1);
}

#[test]
fn real_adapter_unknown_model_or_effort_keeps_same_record_ratios_without_neighbors() {
    for missing in [&["model"][..], &["effort"][..], &["model", "effort"][..]] {
        let root = tempfile::tempdir().unwrap();
        let mut context = source_context();
        for field in missing {
            context["payload"].as_object_mut().unwrap().remove(*field);
        }
        let mut before = source_legacy();
        before["payload"]["info"]
            .as_object_mut()
            .unwrap()
            .remove("total_token_usage");
        before["payload"]["response_id"] = serde_json::json!("before");
        let mut after = before.clone();
        after["timestamp"] = serde_json::json!("2026-10-04T00:00:04Z");
        after["payload"]["response_id"] = serde_json::json!("after");
        after["payload"]["info"]["last_token_usage"] = source_counts(50);
        write_source(
            root.path(),
            "parent.jsonl",
            &[
                source_meta("parent"),
                context,
                before,
                serde_json::json!({"type":"event_msg","timestamp":"2026-10-04T00:00:03Z", "payload":{
                "type":"item_completed", "item":{"type":"ContextCompaction","id":"compact"}}}),
                after,
            ],
        );
        let collected = collect_source(root.path());
        assert_eq!(collected.measurements.len(), 2);
        for measurement in &collected.measurements {
            assert!(measurement.request_scoped);
            if missing.contains(&"model") {
                assert!(measurement.model.raw.is_none());
            }
            if missing.contains(&"effort") {
                assert!(measurement.reasoning_effort.is_none());
            }
        }
        let result = summarize_events(&collected.measurements, &collected.events);
        assert_eq!(result.candidates, 2);
        assert_eq!(result.input.samples, 2);
        assert_eq!(result.ratio.samples, 2);
        assert_eq!(result.ratio.p90, Some(0.095));
        assert_eq!(
            result
                .segments
                .iter()
                .map(|segment| segment.same_record_windows)
                .sum::<usize>(),
            2
        );
        assert_eq!(
            result
                .segments
                .iter()
                .map(|segment| segment.continued_windows)
                .sum::<usize>(),
            0
        );
        assert_eq!(result.compactions.len(), 1);
        assert_eq!(result.compactions[0].before, None);
        assert_eq!(result.compactions[0].after, None);
    }
}
