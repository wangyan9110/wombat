//! Independent safe phase observations; adapter outputs and duration proxies are not the oracle.
use super::*;

fn operation_event(
    offset: u64,
    call: Option<&str>,
    native_item: Option<&str>,
    phase: Phase,
    millis: Option<i64>,
) -> Arc<Event> {
    let value = serde_json::from_value(serde_json::json!({
        "id": format!("canonical-{offset}"), "threadId":"thread", "turnId":"turn",
        "callId":call, "itemId":native_item, "kind":"mcpTool", "name":"lookup",
        "server":"server", "tool":"lookup", "sequence":offset,
        // A reconciled operation timestamp/duration is not a phase endpoint.
        "timestamp":"2000-01-01T00:00:00Z", "durationMs":999999,
        "timePrecision":"second", "status":"completed", "outcomeConflict":false,
        "evidence":[]
    }))
    .unwrap();
    event(
        offset,
        millis,
        Payload::Operation {
            value: Arc::new(value),
            phase,
        },
    )
}
fn position_variant(event: &Arc<Event>, ordinal: u32, file: &str, generation: &str) -> Arc<Event> {
    let mut position = event.position().clone();
    position.ordinal = ordinal;
    position.file_id = file.into();
    position.generation = generation.into();
    Arc::new(
        Event::new(
            position,
            event.thread_id().map(str::to_owned),
            event.turn_id().map(str::to_owned),
            event.time().clone(),
            event.gaps().to_vec(),
            event.payload().clone(),
        )
        .unwrap(),
    )
}
fn with_boundaries(mut events: Vec<Arc<Event>>) -> Vec<Arc<Event>> {
    events.push(boundary(100, Some(0), Phase::Started, None, None));
    events.push(boundary(200, Some(100), Phase::Completed, Some(100), None));
    events
}
#[test]
fn native_mcp_endpoints_map_into_the_fourth_category_and_mask() {
    let result = analyze_events(&with_boundaries(vec![item(
        1,
        Some("native"),
        ItemKind::Mcp,
        Phase::Completed,
        Some(10),
        Some(30),
        Some(35),
    )]));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.coverage.linked_lifecycles[3], 1);
    assert_eq!(result.intervals.mask_ms[8], 20);
    assert_eq!(result.intervals.category_sum_ms[3], 20);
    assert_eq!(
        result.intervals.timeline.tracks[0].category,
        intervals::Category::Mcp
    );
}
#[test]
fn legacy_mcp_phases_and_command_overlap_use_recorded_event_times() {
    let result = analyze_events(&with_boundaries(vec![
        operation_event(1, Some("call"), None, Phase::Started, Some(10)),
        operation_event(2, Some("call"), None, Phase::Completed, Some(60)),
        item(
            3,
            Some("command"),
            ItemKind::Command,
            Phase::Completed,
            Some(30),
            Some(80),
            Some(90),
        ),
    ]));
    assert_eq!(result.category_union_ms[3], Some(50));
    assert_eq!(result.category_union_ms[0], Some(50));
    assert_eq!(result.intervals.covered_ms, Some(70));
    assert_eq!(result.intervals.mask_ms[8], 20);
    assert_eq!(result.intervals.mask_ms[9], 30);
    assert_eq!(result.intervals.mask_ms[1], 20);
}
#[test]
fn native_operation_same_rows_and_legacy_mirrors_deduplicate_with_native_endpoint_priority() {
    let native_start = item(
        1,
        Some("native"),
        ItemKind::Mcp,
        Phase::Started,
        Some(10),
        None,
        Some(15),
    );
    let native_end = item(
        2,
        Some("native"),
        ItemKind::Mcp,
        Phase::Completed,
        Some(10),
        Some(30),
        Some(35),
    );
    let start = position_variant(
        &operation_event(1, Some("call"), Some("native"), Phase::Started, Some(15)),
        1,
        "file",
        "generation",
    );
    let end = position_variant(
        &operation_event(2, Some("call"), Some("native"), Phase::Completed, Some(35)),
        1,
        "file",
        "generation",
    );
    let events = with_boundaries(vec![
        native_start,
        native_end,
        start,
        end,
        operation_event(3, Some("call"), None, Phase::Started, Some(10)),
        operation_event(4, Some("call"), None, Phase::Completed, Some(30)),
    ]);
    for events in [events.clone(), events.into_iter().rev().collect()] {
        let result = analyze_events(&events);
        assert_eq!(result.category_union_ms[3], Some(20));
        assert_eq!(result.intervals.category_sum_ms[3], 20);
        assert_eq!(result.coverage.linked_lifecycles[3], 1);
        assert_eq!(result.intervals.timeline.track_count, 1);
        assert_eq!(result.coverage.conflicting_lifecycles, 0);
    }
}
#[test]
fn same_row_call_only_native_fallback_has_association_proof() {
    let native = item(
        1,
        Some("call"),
        ItemKind::Mcp,
        Phase::Completed,
        Some(10),
        Some(30),
        Some(35),
    );
    let end = position_variant(
        &operation_event(1, Some("call"), None, Phase::Completed, Some(35)),
        1,
        "file",
        "generation",
    );
    let result = analyze_events(&with_boundaries(vec![
        native,
        end,
        operation_event(2, Some("call"), None, Phase::Started, Some(10)),
    ]));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.intervals.category_sum_ms[3], 20);
    assert_eq!(result.coverage.linked_lifecycles[3], 1);
}
#[test]
fn item_and_call_namespaces_do_not_merge_matching_text_without_a_bridge() {
    let result = analyze_events(&with_boundaries(vec![
        item(
            1,
            Some("same-text"),
            ItemKind::Mcp,
            Phase::Completed,
            Some(10),
            Some(30),
            Some(35),
        ),
        operation_event(2, Some("same-text"), None, Phase::Started, Some(20)),
        operation_event(3, Some("same-text"), None, Phase::Completed, Some(50)),
    ]));
    assert_eq!(result.category_union_ms[3], Some(40));
    assert_eq!(result.intervals.category_sum_ms[3], 50);
    assert_eq!(result.coverage.linked_lifecycles[3], 2);
    assert_eq!(result.coverage.conflicting_lifecycles, 0);
}
#[test]
fn conflicting_mcp_identity_does_not_hide_an_independent_mcp_interval_or_native_usage() {
    let result = analyze_events(&with_boundaries(vec![
        operation_event(1, Some("conflict"), None, Phase::Started, Some(10)),
        operation_event(2, Some("conflict"), None, Phase::Started, Some(20)),
        operation_event(3, Some("conflict"), None, Phase::Completed, Some(30)),
        operation_event(4, Some("known"), None, Phase::Started, Some(40)),
        operation_event(5, Some("known"), None, Phase::Completed, Some(60)),
    ]));
    assert_eq!(result.native_wall_clock_ms, Some(100));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.coverage.conflicting_lifecycles, 1);
    assert_eq!(result.coverage.linked_lifecycles[3], 1);
}
#[test]
fn missing_mcp_time_and_identity_do_not_invent_positions_or_hide_known_intervals() {
    let result = analyze_events(&with_boundaries(vec![
        operation_event(1, Some("undated"), None, Phase::Started, None),
        operation_event(2, Some("undated"), None, Phase::Completed, Some(30)),
        operation_event(3, None, None, Phase::Completed, Some(50)),
        operation_event(4, Some("known"), None, Phase::Started, Some(60)),
        operation_event(5, Some("known"), None, Phase::Completed, Some(80)),
    ]));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.coverage.missing_identity_lifecycles, 1);
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::MissingItemTime(_)))
    );
    assert_eq!(result.intervals.timeline.unlocated_count, 1);
    assert_eq!(result.native_wall_clock_ms, Some(100));
}
#[test]
fn cross_file_or_generation_mcp_phases_do_not_supply_a_same_clock_domain_pair() {
    for (file, generation) in [("other-file", "generation"), ("file", "other-generation")] {
        let start = operation_event(1, Some("call"), None, Phase::Started, Some(10));
        let end = position_variant(
            &operation_event(2, Some("call"), None, Phase::Completed, Some(30)),
            0,
            file,
            generation,
        );
        let result = analyze_events(&with_boundaries(vec![start, end]));
        assert_eq!(result.category_union_ms[3], None);
        assert_eq!(result.coverage.linked_lifecycles[3], 0);
        assert_eq!(result.native_wall_clock_ms, Some(100));
        assert!(
            result
                .issues
                .iter()
                .any(|issue| matches!(issue, Issue::UnmatchedClockDomain(_)))
        );
    }
}
#[test]
fn outside_source_and_unassigned_turns_cannot_bridge_mcp_aliases() {
    let known = operation_event(1, Some("call"), None, Phase::Started, Some(10));
    let end = operation_event(2, Some("call"), None, Phase::Completed, Some(30));
    let mut position = end.position().clone();
    position.source_instance_id = "outside".into();
    let outside = Arc::new(
        Event::new(
            position,
            Some("thread".into()),
            Some("turn".into()),
            end.time().clone(),
            vec![],
            end.payload().clone(),
        )
        .unwrap(),
    );
    let result = analyze_events(&with_boundaries(vec![known, outside]));
    assert_eq!(result.category_union_ms[3], None);
    assert_eq!(result.coverage.outside_events, 1);
    assert_eq!(result.coverage.linked_lifecycles[3], 0);

    let Payload::Operation { value, phase } = end.payload() else {
        unreachable!()
    };
    for (thread, turn) in [
        ("thread", None),
        ("outside-thread", Some("turn")),
        ("thread", Some("outside-turn")),
    ] {
        let mut value = value.as_ref().clone();
        value.thread_id = thread.into();
        value.turn_id = turn.map(Into::into);
        let scoped = Arc::new(
            Event::new(
                end.position().clone(),
                Some(thread.into()),
                turn.map(str::to_owned),
                end.time().clone(),
                vec![],
                Payload::Operation {
                    value: Arc::new(value),
                    phase: phase.clone(),
                },
            )
            .unwrap(),
        );
        let result = analyze_events(&with_boundaries(vec![
            operation_event(1, Some("call"), None, Phase::Started, Some(10)),
            scoped,
        ]));
        assert_eq!(result.category_union_ms[3], None);
        assert_eq!(result.coverage.linked_lifecycles[3], 0);
        assert_eq!(
            result.coverage.unassigned_events + result.coverage.outside_events,
            1
        );
    }
}
#[test]
fn native_completion_is_closure_while_operation_failure_is_the_outcome() {
    let native = item(
        1,
        Some("native"),
        ItemKind::Mcp,
        Phase::Completed,
        Some(10),
        Some(30),
        Some(35),
    );
    let failed = position_variant(
        &operation_event(1, Some("call"), Some("native"), Phase::Failed, Some(35)),
        1,
        "file",
        "generation",
    );
    let result = analyze_events(&with_boundaries(vec![native, failed]));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.coverage.conflicting_lifecycles, 0);
}

#[test]
fn explicit_dispatch_target_conflict_keeps_consistent_mcp_interval() {
    let start = operation_event(1, Some("conflict"), None, Phase::Started, Some(10));
    let end = operation_event(2, Some("conflict"), None, Phase::Completed, Some(30));
    let Payload::Operation { value, phase } = end.payload() else {
        unreachable!()
    };
    let mut other_server = value.as_ref().clone();
    other_server.server = Some("different-server".into());
    let conflicting = event(
        5,
        Some(30),
        Payload::Operation {
            value: Arc::new(other_server),
            phase: phase.clone(),
        },
    );
    let result = analyze_events(&with_boundaries(vec![
        start,
        conflicting,
        operation_event(3, Some("known"), None, Phase::Started, Some(40)),
        operation_event(4, Some("known"), None, Phase::Completed, Some(60)),
    ]));
    assert_eq!(result.category_union_ms[3], Some(40));
    assert_eq!(result.operation_coverage.covered_ms, Some(40));
    assert_eq!(result.operation_coverage.paired, 2);
    assert_eq!(result.operation_coverage.conflicting, 0);
    assert_eq!(result.coverage.conflicting_lifecycles, 0);
    assert_eq!(result.coverage.linked_lifecycles[3], 2);
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::TargetConflict(_)))
    );
}

#[test]
fn malformed_native_duration_does_not_discard_valid_mcp_endpoints() {
    let native = item(
        1,
        Some("native"),
        ItemKind::Mcp,
        Phase::Completed,
        Some(10),
        Some(30),
        Some(35),
    );
    // The adapter omits a malformed duration and records InvalidNativeField;
    // that shared gap does not establish that either recorded endpoint is invalid.
    let native = Arc::new(
        Event::new(
            native.position().clone(),
            native.thread_id().map(str::to_owned),
            native.turn_id().map(str::to_owned),
            native.time().clone(),
            vec![Gap::InvalidNativeField],
            native.payload().clone(),
        )
        .unwrap(),
    );
    let result = analyze_events(&with_boundaries(vec![native.clone()]));
    assert_eq!(result.category_union_ms[3], Some(20));
    assert_eq!(result.intervals.category_sum_ms[3], 20);
    assert_eq!(result.coverage.linked_lifecycles[3], 1);
    assert_eq!(result.coverage.conflicting_lifecycles, 0);
    assert_eq!(result.intervals.timeline.track_count, 1);
    assert!(
        result
            .issues
            .contains(&Issue::SourceGap(native.id().into()))
    );
}
