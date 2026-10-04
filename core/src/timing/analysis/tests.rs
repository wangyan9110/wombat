use super::*;
use crate::session_events::{NativeDuration, Position, Time};

fn event(offset: u64, millis: Option<i64>, payload: Payload) -> Arc<Event> {
    let text = millis.map(|millis| {
        chrono::DateTime::from_timestamp_millis(millis)
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    });
    Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "generation".into(),
                byte_offset: offset,
                ordinal: 0,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(text.as_deref()).0,
            vec![],
            payload,
        )
        .unwrap(),
    )
}
fn boundary(
    offset: u64,
    millis: Option<i64>,
    phase: Phase,
    duration: Option<u64>,
    ttft: Option<u64>,
) -> Arc<Event> {
    event(
        offset,
        millis,
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Turn,
            phase,
            native_id: Some("native-turn".into()),
            duration_ms: duration,
            first_token_ms: ttft,
        },
    )
}
fn item(
    offset: u64,
    id: Option<&str>,
    kind: ItemKind,
    phase: Phase,
    start: Option<i64>,
    end: Option<i64>,
    envelope: Option<i64>,
) -> Arc<Event> {
    event(
        offset,
        envelope,
        Payload::Item {
            item_kind: kind,
            native_id: id.map(str::to_owned),
            phase,
            started_at_ms: start,
            completed_at_ms: end,
            duration: None,
        },
    )
}
fn analyze_events(events: &[Arc<Event>]) -> Analysis {
    analyze(AnalyzeInput {
        source: "source",
        thread: "thread",
        turn: "turn",
        events,
        measurements: &[],
        budget: Budget {
            events: 100,
            measurements: 100,
            lifecycle_records: 100,
        },
    })
}
#[test]
fn native_and_locatable_durations_remain_separate() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, Some(120), Some(0)),
        item(
            1,
            Some("command"),
            ItemKind::Command,
            Phase::Completed,
            Some(30),
            Some(80),
            Some(90),
        ),
        item(
            2,
            Some("reason"),
            ItemKind::Reasoning,
            Phase::Completed,
            Some(20),
            Some(50),
            None,
        ),
        item(
            3,
            Some("compact"),
            ItemKind::Compaction,
            Phase::Completed,
            Some(0),
            Some(30),
            None,
        ),
    ]);
    assert_eq!(result.method, "safe_event_turn_v1");
    assert_eq!(result.response_gap_union_ms, None);
    assert_eq!(result.native_wall_clock_ms, Some(120));
    assert_eq!(result.derived_wall_clock_ms, Some(100));
    assert_eq!(result.boundary_delta_ms, Some(20));
    assert_eq!(result.native_ttft_ms, Some(0));
    assert_eq!(result.intervals.covered_ms, Some(80));
    assert_eq!(result.intervals.unclassified_ms, Some(20));
    assert_eq!(result.category_union_ms, [Some(50), Some(30), Some(30)]);
    assert_eq!(result.intervals.gap_union_ms, 0);
    assert_eq!(
        result.response_gap_support,
        ResponseGapSupport::UnsupportedMissingContentAndBatchEvidence
    );
    assert_eq!(result.first_content_record_delay_ms, None);
}
#[test]
fn duration_never_supplies_absolute_window_or_item_end() {
    let result = analyze_events(&[
        boundary(0, None, Phase::Completed, Some(100), Some(10)),
        event(
            1,
            None,
            Payload::Item {
                item_kind: ItemKind::Command,
                native_id: Some("duration-only".into()),
                phase: Phase::Completed,
                started_at_ms: Some(0),
                completed_at_ms: None,
                duration: Some(NativeDuration { secs: 1, nanos: 0 }),
            },
        ),
    ]);
    assert_eq!(result.native_wall_clock_ms, Some(100));
    assert_eq!(result.derived_wall_clock_ms, None);
    assert_eq!(result.intervals.observed_window_ms, None);
    assert_eq!(result.category_union_ms, [None; 3]);
    assert_eq!(result.intervals.complete_intervals, [0; 3]);
}
#[test]
fn open_and_missing_identity_are_not_closed_coverage() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, Some(500), None),
        item(
            1,
            Some("open"),
            ItemKind::Command,
            Phase::Started,
            Some(1),
            Some(50),
            None,
        ),
        item(
            2,
            None,
            ItemKind::Compaction,
            Phase::Completed,
            Some(1),
            Some(50),
            None,
        ),
    ]);
    assert_eq!(result.state, State::Running);
    assert_eq!(result.native_wall_clock_ms, None);
    assert_eq!(result.intervals.complete_intervals, [0; 3]);
    assert_eq!(result.coverage.lifecycle_candidates, [1, 1, 0]);
    assert_eq!(result.coverage.missing_identity_lifecycles, 1);
    assert_eq!(result.intervals.covered_ms, None);
}
#[test]
fn explicit_identity_pairs_and_conflicts_never_merge_by_time() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(20, Some(100), Phase::Completed, None, None),
        item(
            1,
            Some("a"),
            ItemKind::Command,
            Phase::Started,
            None,
            None,
            Some(10),
        ),
        item(
            2,
            Some("a"),
            ItemKind::Command,
            Phase::Completed,
            None,
            None,
            Some(20),
        ),
        item(
            3,
            Some("conflict"),
            ItemKind::Reasoning,
            Phase::Completed,
            Some(30),
            Some(40),
            None,
        ),
        item(
            4,
            Some("conflict"),
            ItemKind::Reasoning,
            Phase::Completed,
            Some(31),
            Some(40),
            None,
        ),
        item(
            5,
            Some("b"),
            ItemKind::Command,
            Phase::Started,
            None,
            None,
            Some(20),
        ),
        item(
            6,
            Some("c"),
            ItemKind::Command,
            Phase::Completed,
            None,
            None,
            Some(30),
        ),
    ]);
    assert_eq!(result.category_union_ms, [Some(10), None, None]);
    assert_eq!(result.coverage.linked_lifecycles, [1, 0, 0]);
    assert_eq!(result.coverage.conflicting_lifecycles, 1);
    assert!(
        result
            .issues
            .contains(&Issue::IdentityConflict("conflict".into()))
    );
    assert_eq!(result.intervals.unclassified_ms, Some(90));
}
#[test]
fn native_item_endpoints_win_over_envelope_write_time() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        item(
            1,
            Some("a"),
            ItemKind::Command,
            Phase::Started,
            None,
            None,
            Some(15),
        ),
        item(
            2,
            Some("a"),
            ItemKind::Command,
            Phase::Completed,
            Some(10),
            Some(20),
            Some(25),
        ),
    ]);
    assert_eq!(result.category_union_ms[0], Some(10));
    assert_eq!(result.coverage.conflicting_lifecycles, 0);
}
#[test]
fn zero_duration_is_known_and_absent_categories_are_unknown() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(0), Phase::Completed, Some(0), Some(0)),
        item(
            1,
            Some("zero"),
            ItemKind::Command,
            Phase::Completed,
            Some(0),
            Some(0),
            None,
        ),
    ]);
    assert_eq!(result.native_wall_clock_ms, Some(0));
    assert_eq!(result.intervals.observed_window_ms, Some(0));
    assert_eq!(result.intervals.coverage_ratio, None);
    assert_eq!(result.category_union_ms, [Some(0), None, None]);
}
fn measurement(id: &str, thread: &str, turn: &str) -> Arc<Measurement> {
    Arc::new(serde_json::from_value(serde_json::json!({
        "id":id,"agentKind":"codex","sourceInstanceId":"source", "threadId":thread,"turnId":turn,"grain":"response","timePrecision":"millisecond","model":{"raw":"model"},"tokens":{"rawInput":0},"requestScoped":true,"sequence":0,"evidence":[]
    })).unwrap())
}
#[test]
fn exact_scope_filters_canonical_samples_and_unassigned_events() {
    let scoped = boundary(0, Some(0), Phase::Started, None, None);
    let other = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "other-file".into(),
                generation: "g".into(),
                byte_offset: 0,
                ordinal: 0,
            },
            Some("other".into()),
            Some("other-turn".into()),
            Time::from_source(None).0,
            vec![],
            Payload::Activity {
                activity: crate::session_events::ActivityKind::Assistant,
            },
        )
        .unwrap(),
    );
    let unassigned = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "other-file".into(),
                generation: "g".into(),
                byte_offset: 1,
                ordinal: 0,
            },
            Some("thread".into()),
            None,
            Time::from_source(None).0,
            vec![],
            Payload::Activity {
                activity: crate::session_events::ActivityKind::Assistant,
            },
        )
        .unwrap(),
    );
    let result = analyze(AnalyzeInput {
        source: "source",
        thread: "thread",
        turn: "turn",
        events: &[scoped, other, unassigned],
        measurements: &[
            measurement("yes", "thread", "turn"),
            measurement("no", "thread", "other-turn"),
        ],
        budget: Budget {
            events: 3,
            measurements: 2,
            lifecycle_records: 0,
        },
    });
    assert_eq!(result.coverage.scoped_events, 1);
    assert_eq!(result.coverage.outside_events, 1);
    assert_eq!(result.coverage.unassigned_events, 1);
    assert_eq!(result.coverage.scoped_measurements, 1);
    assert_eq!(result.context.as_ref().unwrap().input.samples, 1);
    assert_eq!(result.context.unwrap().input.median, Some(0.0));
}
#[test]
fn budgets_are_checked_before_context_or_interval_analysis() {
    let events = [
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        item(
            1,
            Some("a"),
            ItemKind::Command,
            Phase::Completed,
            Some(10),
            Some(20),
            None,
        ),
    ];
    for budget in [
        Budget {
            events: 2,
            measurements: 1,
            lifecycle_records: 3,
        },
        Budget {
            events: 3,
            measurements: 0,
            lifecycle_records: 3,
        },
    ] {
        let result = analyze(AnalyzeInput {
            source: "source",
            thread: "thread",
            turn: "turn",
            events: &events,
            measurements: &[measurement("m", "thread", "turn")],
            budget,
        });
        assert!(result.coverage.partial);
        assert!(result.context.is_none());
        assert_eq!(result.intervals.covered_ms, None);
    }
    let result = analyze(AnalyzeInput {
        source: "source",
        thread: "thread",
        turn: "turn",
        events: &events,
        measurements: &[],
        budget: Budget {
            events: 3,
            measurements: 0,
            lifecycle_records: 0,
        },
    });
    assert!(result.coverage.partial);
    assert!(result.intervals.partial);
    assert_eq!(result.intervals.observed_window_ms, Some(100));
    assert_eq!(result.intervals.covered_ms, None);
    assert_eq!(result.category_union_ms, [None; 3]);
}
#[test]
fn conflicting_turn_boundaries_do_not_rescale_or_close_window() {
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(1, Some(1), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, Some(100), None),
    ]);
    assert_eq!(result.state, State::Completed);
    assert_eq!(result.derived_wall_clock_ms, None);
    assert_eq!(result.native_wall_clock_ms, Some(100));
    assert!(result.issues.contains(&Issue::BoundaryConflict));
}

#[test]
fn duplicate_copies_count_one_interval_and_distinct_ids_count_independently() {
    let first = item(
        1,
        Some("a"),
        ItemKind::Command,
        Phase::Completed,
        Some(10),
        Some(20),
        None,
    );
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        first.clone(),
        first,
        item(
            2,
            Some("b"),
            ItemKind::Command,
            Phase::Completed,
            Some(10),
            Some(20),
            None,
        ),
    ]);
    assert_eq!(result.coverage.lifecycle_candidates, [3, 0, 0]);
    assert_eq!(result.intervals.complete_intervals, [2, 0, 0]);
    assert_eq!(result.intervals.category_sum_ms[0], 20);
    assert_eq!(result.category_union_ms[0], Some(10));
}

#[test]
fn clock_domains_cannot_pair_missing_boundaries_or_item_halves() {
    let start = boundary(0, Some(0), Phase::Started, None, None);
    let end = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "replacement".into(),
                byte_offset: 1,
                ordinal: 0,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(Some("1970-01-01T00:00:00.100Z")).0,
            vec![],
            Payload::Lifecycle {
                lifecycle: LifecycleKind::Turn,
                phase: Phase::Completed,
                native_id: Some("native-turn".into()),
                duration_ms: Some(100),
                first_token_ms: None,
            },
        )
        .unwrap(),
    );
    let result = analyze_events(&[start, end]);
    assert_eq!(result.intervals.observed_window_ms, None);
    assert_eq!(result.native_wall_clock_ms, Some(100));
    assert!(result.issues.contains(&Issue::BoundaryConflict));
}

#[test]
fn explicit_identity_gap_and_conflicting_terminal_states_exclude_intervals() {
    let conflicted = Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "generation".into(),
                byte_offset: 1,
                ordinal: 0,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(None).0,
            vec![Gap::ConflictingIdentity, Gap::SourcePartial],
            Payload::Item {
                item_kind: ItemKind::Command,
                native_id: Some("conflicted".into()),
                phase: Phase::Completed,
                started_at_ms: Some(10),
                completed_at_ms: Some(20),
                duration: None,
            },
        )
        .unwrap(),
    );
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        conflicted,
        item(
            2,
            Some("states"),
            ItemKind::Reasoning,
            Phase::Completed,
            Some(30),
            Some(40),
            None,
        ),
        item(
            3,
            Some("states"),
            ItemKind::Reasoning,
            Phase::Failed,
            Some(30),
            Some(40),
            None,
        ),
    ]);
    assert!(result.coverage.partial);
    assert_eq!(result.coverage.conflicting_lifecycles, 2);
    assert_eq!(result.category_union_ms, [None; 3]);
    assert_eq!(result.intervals.unclassified_ms, Some(100));
}

#[test]
fn cancelled_and_failed_turns_retain_distinct_states() {
    for (phase, state) in [
        (Phase::Cancelled, State::Cancelled),
        (Phase::Failed, State::Failed),
    ] {
        let result = analyze_events(&[
            boundary(0, Some(0), Phase::Started, None, None),
            boundary(10, Some(100), phase, None, None),
        ]);
        assert_eq!(result.state, state);
        assert_eq!(result.derived_wall_clock_ms, Some(100));
    }
}

fn copy_to_domain(value: &Arc<Event>, file: &str, generation: &str) -> Arc<Event> {
    let mut position = value.position().clone();
    position.file_id = file.into();
    position.generation = generation.into();
    Arc::new(
        Event::new(
            position,
            value.thread_id().map(str::to_owned),
            value.turn_id().map(str::to_owned),
            value.time().clone(),
            value.gaps().to_vec(),
            value.payload().clone(),
        )
        .unwrap(),
    )
}

#[test]
fn explicit_native_replay_across_files_and_generations_has_one_work_sum() {
    let start = boundary(0, Some(0), Phase::Started, None, None);
    let end = boundary(10, Some(100), Phase::Completed, Some(100), None);
    let command = item(
        1,
        Some("native-command"),
        ItemKind::Command,
        Phase::Completed,
        Some(10),
        Some(30),
        None,
    );
    for (file, generation) in [("replay-file", "generation"), ("file", "replacement")] {
        let result = analyze_events(&[
            start.clone(),
            end.clone(),
            command.clone(),
            copy_to_domain(&start, file, generation),
            copy_to_domain(&end, file, generation),
            copy_to_domain(&command, file, generation),
        ]);
        assert_eq!(result.intervals.observed_window_ms, Some(100));
        assert_eq!(result.coverage.lifecycle_candidates, [2, 0, 0]);
        assert_eq!(result.coverage.linked_lifecycles, [1, 0, 0]);
        assert_eq!(result.intervals.complete_intervals, [1, 0, 0]);
        assert_eq!(result.intervals.category_sum_ms[0], 20);
        assert_eq!(result.category_union_ms[0], Some(20));
        assert_eq!(result.intervals.unclassified_ms, Some(80));
    }
}

#[test]
fn explicit_native_identity_cannot_join_start_end_across_clock_domains() {
    let command_start = item(
        1,
        Some("native-command"),
        ItemKind::Command,
        Phase::Started,
        None,
        None,
        Some(10),
    );
    let command_end = item(
        2,
        Some("native-command"),
        ItemKind::Command,
        Phase::Completed,
        None,
        None,
        Some(30),
    );
    for (file, generation) in [("replay-file", "generation"), ("file", "replacement")] {
        let result = analyze_events(&[
            boundary(0, Some(0), Phase::Started, None, None),
            boundary(10, Some(100), Phase::Completed, None, None),
            command_start.clone(),
            copy_to_domain(&command_end, file, generation),
        ]);
        assert_eq!(result.coverage.lifecycle_candidates, [2, 0, 0]);
        assert_eq!(result.intervals.candidates, [1, 0, 0]);
        assert_eq!(result.intervals.complete_intervals, [0; 3]);
        assert_eq!(result.intervals.category_sum_ms[0], 0);
        assert_eq!(result.category_union_ms[0], None);
        assert!(
            result
                .issues
                .contains(&Issue::UnmatchedClockDomain("native-command".into()))
        );
    }
}

#[test]
fn conflicting_native_replay_endpoints_exclude_all_copies() {
    let command = item(
        1,
        Some("native-command"),
        ItemKind::Command,
        Phase::Completed,
        Some(10),
        Some(30),
        None,
    );
    let conflicting_copy = item(
        2,
        Some("native-command"),
        ItemKind::Command,
        Phase::Completed,
        Some(10),
        Some(40),
        None,
    );
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        command,
        copy_to_domain(&conflicting_copy, "replay-file", "generation"),
    ]);
    assert_eq!(result.coverage.conflicting_lifecycles, 1);
    assert_eq!(result.intervals.complete_intervals, [0; 3]);
    assert_eq!(result.intervals.category_sum_ms[0], 0);
    assert_eq!(result.category_union_ms[0], None);
    assert_eq!(result.intervals.unclassified_ms, Some(100));
}

#[test]
fn unidentified_equal_records_remain_two_identity_gaps() {
    let unidentified = item(
        1,
        None,
        ItemKind::Command,
        Phase::Completed,
        Some(10),
        Some(30),
        None,
    );
    let result = analyze_events(&[
        boundary(0, Some(0), Phase::Started, None, None),
        boundary(10, Some(100), Phase::Completed, None, None),
        unidentified.clone(),
        copy_to_domain(&unidentified, "replay-file", "generation"),
    ]);
    assert_eq!(result.coverage.lifecycle_candidates, [2, 0, 0]);
    assert_eq!(result.coverage.missing_identity_lifecycles, 2);
    assert_eq!(result.intervals.complete_intervals, [0; 3]);
    assert_eq!(result.category_union_ms[0], None);
}

fn context_input(id: &str) -> Arc<Measurement> {
    let mut value = measurement(id, "thread", "turn").as_ref().clone();
    value.reasoning_effort = Some("high".into());
    value.tokens.raw_input = Some(100);
    Arc::new(value)
}

fn context_analysis(control: Arc<Event>) -> Analysis {
    let first = context_input("first");
    let second = context_input("second");
    let mut window_position = event(
        10,
        Some(10),
        Payload::Activity {
            activity: crate::session_events::ActivityKind::Assistant,
        },
    )
    .position()
    .clone();
    window_position.ordinal = 1;
    let window = Arc::new(
        Event::new(
            window_position,
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(Some("1970-01-01T00:00:00.010Z")).0,
            vec![],
            Payload::ContextWindow {
                model: Some("model".into()),
                tokens: 1000,
            },
        )
        .unwrap(),
    );
    let events = [
        event(
            10,
            Some(10),
            Payload::Measurement {
                value: first.clone(),
                direct: true,
                cumulative: None,
                interval_start: None,
                fingerprint: "first".into(),
            },
        ),
        window,
        control,
        event(
            30,
            Some(30),
            Payload::Measurement {
                value: second.clone(),
                direct: true,
                cumulative: None,
                interval_start: None,
                fingerprint: "second".into(),
            },
        ),
    ];
    analyze(AnalyzeInput {
        source: "source",
        thread: "thread",
        turn: "turn",
        measurements: &[first, second],
        events: &events,
        budget: Budget {
            events: 10,
            measurements: 10,
            lifecycle_records: 10,
        },
    })
}

fn unassigned_gap(position: Position, thread: Option<&str>, payload: Payload) -> Arc<Event> {
    Arc::new(
        Event::new(
            position,
            thread.map(str::to_owned),
            None,
            Time::from_source(Some("1970-01-01T00:00:00.020Z")).0,
            vec![Gap::SourcePartial],
            payload,
        )
        .unwrap(),
    )
}

#[test]
fn unassigned_source_breaks_stop_context_continuation_without_adding_payload_samples() {
    let position = Position {
        source_instance_id: "source".into(),
        file_id: "file".into(),
        generation: "generation".into(),
        byte_offset: 20,
        ordinal: 0,
    };
    let mut unassigned_sample = context_input("first").as_ref().clone();
    unassigned_sample.turn_id = None;
    let payloads = [
        Payload::Activity {
            activity: crate::session_events::ActivityKind::Assistant,
        },
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Compaction,
            phase: Phase::Completed,
            native_id: None,
            duration_ms: None,
            first_token_ms: None,
        },
        Payload::Measurement {
            value: Arc::new(unassigned_sample),
            direct: true,
            cumulative: None,
            interval_start: None,
            fingerprint: "unassigned".into(),
        },
    ];
    for payload in payloads {
        let control = unassigned_gap(position.clone(), Some("thread"), payload);
        let id = control.id().to_owned();
        let result = context_analysis(control);
        let context = result.context.unwrap();
        assert_eq!(context.candidates, 2);
        assert_eq!(context.input.samples, 2);
        assert_eq!(context.ratio.samples, 1);
        assert!(context.compactions.is_empty());
        assert_eq!(result.coverage.scoped_events, 3);
        assert_eq!(result.coverage.unassigned_events, 1);
        assert_eq!(result.coverage.lifecycle_candidates, [0; 3]);
        assert!(result.coverage.partial);
        assert!(result.issues.contains(&Issue::SourceGap(id)));
    }
}

#[test]
fn unrelated_source_thread_file_generation_and_outside_span_gaps_do_not_pollute_turn() {
    let position = Position {
        source_instance_id: "source".into(),
        file_id: "file".into(),
        generation: "generation".into(),
        byte_offset: 20,
        ordinal: 0,
    };
    let mut cases = vec![(position.clone(), Some("other-thread"))];
    for (source, file, generation, offset) in [
        ("other-source", "file", "generation", 20),
        ("source", "other-file", "generation", 20),
        ("source", "file", "other-generation", 20),
        ("source", "file", "generation", 9),
        ("source", "file", "generation", 31),
    ] {
        cases.push((
            Position {
                source_instance_id: source.into(),
                file_id: file.into(),
                generation: generation.into(),
                byte_offset: offset,
                ordinal: 0,
            },
            Some("thread"),
        ));
    }
    for (position, thread) in cases {
        let control = unassigned_gap(
            position,
            thread,
            Payload::Activity {
                activity: crate::session_events::ActivityKind::Assistant,
            },
        );
        let id = control.id().to_owned();
        let result = context_analysis(control);
        assert_eq!(result.context.unwrap().ratio.samples, 2);
        assert!(!result.coverage.partial);
        assert!(!result.issues.contains(&Issue::SourceGap(id)));
    }
}
