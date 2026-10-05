use super::*;
use crate::adapters::contract::{Collected, Operation, Thread, Turn};
fn operation(id: &str, kind: &str) -> Arc<Operation> {
    Arc::new(serde_json::from_value(serde_json::json!({"id":id,"threadId":"thread","turnId":"turn","callId":id,"kind":kind,"name":"read_file","path":"/synthetic/skill/SKILL.md","server":"server","tool":"search","sequence":1,"timestamp":"2026-10-04T00:00:00Z","timePrecision":"second","status":"completed","outcomeConflict":false,"evidence":[]})).unwrap())
}
fn data(operations: Vec<Arc<Operation>>) -> Collected {
    Collected {
        operations,
        threads: vec![Thread {
            id: "thread".into(),
            source_instance_id: "source".into(),
            agent_kind: "codex".into(),
            upstream_id: "native".into(),
            title: None,
            project: Some("/synthetic/project".into()),
            started_at: None,
            last_activity_at: None,
        }],
        turns: vec![Turn {
            id: "turn".into(),
            thread_id: "thread".into(),
            upstream_id: "native-turn".into(),
            ordinal: 1,
            started_at: None,
            ended_at: None,
            last_activity_at: None,
            status: "completed".into(),
        }],
        ..Default::default()
    }
}
fn snapshot(operations: Vec<Arc<Operation>>) -> Snapshot {
    let root = tempfile::tempdir().unwrap();
    usage_store::memory(
        data(operations),
        "live:uses".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap()
}
fn target() -> TurnTarget<'static> {
    TurnTarget {
        source: "source",
        thread: "thread",
        turn: "turn",
    }
}
fn request(collection: EvidenceSet, limit: usize) -> Request {
    Request::Evidence {
        thread_id: "thread".into(),
        turn_id: "turn".into(),
        snapshot_id: "live:uses".into(),
        roots: vec![],
        scope: None,
        collection,
        object_ref: None,
        cursor: None,
        limit,
        privacy_profile: PrivacyProfile::Local,
    }
}
fn run(snapshot: &Snapshot, request: &Request) -> Response {
    super::super::query_on_snapshot(
        snapshot,
        request,
        QueryFreshness::default(),
        &AtomicBool::new(false),
    )
    .unwrap()
}
#[test]
fn production_objects_use_shared_counts_and_preserve_failed_replay_details() {
    let first = operation("first", "skillRead");
    let mut failed = operation("retry", "skillRead").as_ref().clone();
    failed.status = "failed".into();
    let snapshot = snapshot(vec![first.clone(), first, Arc::new(failed)]);
    let Response::UseObjects(page) = run(&snapshot, &request(EvidenceSet::UseObjects, 1)) else {
        panic!()
    };
    assert_eq!(page.total.value, Some(1));
    assert_eq!(page.rows[0].use_count.value, Some(2));
    assert_eq!(page.rows[0].record_count.value, Some(3));
    assert_eq!(page.totals.record_count.value, Some(3));
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 2)) else {
        panic!()
    };
    assert_eq!(records.total.value, Some(3));
    assert_eq!(records.rows.len(), 2);
    assert_eq!(
        records.rows[1].replay_of,
        Some(records.rows[0].reference.clone())
    );
    let mut next = request(EvidenceSet::UseRecords, 2);
    if let Request::Evidence { cursor, .. } = &mut next {
        *cursor = records.next_cursor;
    }
    let Response::UseRecords(last) = run(&snapshot, &next) else {
        panic!()
    };
    assert_eq!(last.total.value, Some(3));
    assert_eq!(last.rows.len(), 1);
    assert!(matches!(last.rows[0].outcome, UseOutcome::Failed));
    assert_eq!(last.totals.record_count.value, Some(3));
    assert!(last.next_cursor.is_none());
}
#[test]
fn declined_outcomes_remain_distinct_without_changing_use_counts() {
    let operations = [
        ("skill-declined", "skillRead", "declined"),
        ("mcp-declined", "mcpTool", "declined"),
        ("resource-declined", "mcpResource", "declined"),
        ("skill-no-result", "skillRead", "unknown"),
        ("mcp-failed", "mcpTool", "failed"),
    ]
    .into_iter()
    .map(|(id, kind, status)| {
        let mut op = operation(id, kind).as_ref().clone();
        op.status = status.into();
        Arc::new(op)
    })
    .collect();
    let snapshot = snapshot(operations);
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 200))
    else {
        panic!()
    };
    assert_eq!(records.total.value, Some(5));
    assert_eq!(records.totals.record_count.value, Some(5));
    assert_eq!(
        records
            .rows
            .iter()
            .filter(|row| matches!(row.outcome, UseOutcome::Declined))
            .count(),
        3
    );
    assert_eq!(
        records
            .rows
            .iter()
            .filter(|row| matches!(row.outcome, UseOutcome::Unknown))
            .count(),
        1
    );
    assert_eq!(
        records
            .rows
            .iter()
            .filter(|row| matches!(row.outcome, UseOutcome::Failed))
            .count(),
        1
    );
    assert!(
        records
            .rows
            .iter()
            .all(|row| matches!(row.state, UseState::Used))
    );
    assert_eq!(
        serde_json::to_value(UseOutcome::Declined).unwrap(),
        serde_json::json!("declined")
    );
    let Response::UseObjects(objects) = run(&snapshot, &request(EvidenceSet::UseObjects, 200))
    else {
        panic!()
    };
    for (kind, expected) in [(UseObjectKind::Skill, 2), (UseObjectKind::Mcp, 3)] {
        let object = objects
            .rows
            .iter()
            .find(|object| std::mem::discriminant(&object.kind) == std::mem::discriminant(&kind))
            .unwrap();
        assert_eq!(object.use_count.value, Some(expected));
        assert_eq!(object.associated_use_count.value, Some(expected));
        assert_eq!(object.record_count.value, Some(expected));
    }
}
#[test]
fn outcome_conflicts_keep_negative_results_and_independent_facts() {
    let operations = [
        ("skill-declined", "skillRead", "declined"),
        ("mcp-failed", "mcpTool", "failed"),
    ]
    .into_iter()
    .map(|(id, kind, status)| {
        let mut op = operation(id, kind).as_ref().clone();
        op.status = status.into();
        op.outcome_conflict = true;
        op.exit_code = None;
        op.duration_ms = Some(25);
        Arc::new(op)
    })
    .collect();
    let snapshot = snapshot(operations);
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 200))
    else {
        panic!()
    };
    assert_eq!(records.total.value, Some(2));
    assert!(
        records
            .rows
            .iter()
            .any(|row| matches!(row.outcome, UseOutcome::Declined))
    );
    assert!(
        records
            .rows
            .iter()
            .any(|row| matches!(row.outcome, UseOutcome::Failed))
    );
    for row in &records.rows {
        assert!(matches!(row.state, UseState::Used));
        assert_eq!(row.exit_code, None);
        assert_eq!(row.native_duration_ms, Some(25));
        assert!(row.timestamp_ms.is_some());
        assert!(row.identity_known);
        assert_eq!(row.gap_codes, ["operation_result_conflict"]);
    }
    let Response::UseObjects(objects) = run(&snapshot, &request(EvidenceSet::UseObjects, 200))
    else {
        panic!()
    };
    assert_eq!(objects.totals.record_count.value, Some(2));
    assert!(objects.rows.iter().all(|object| {
        object.use_count.value == Some(1) && object.associated_use_count.value == Some(1)
    }));
}
#[test]
fn object_membership_gaps_do_not_turn_associated_uses_into_zero() {
    let mut unassigned = operation("unassigned", "skillRead").as_ref().clone();
    unassigned.turn_id = None;
    let mut missing_time = operation("read", "skillRead").as_ref().clone();
    missing_time.timestamp = None;
    let snapshot = snapshot(vec![
        Arc::new(unassigned),
        Arc::new(missing_time),
        operation("mcp", "mcpTool"),
    ]);
    let Response::UseObjects(page) = run(&snapshot, &request(EvidenceSet::UseObjects, 200)) else {
        panic!()
    };
    assert_eq!(page.totals.unassigned_skill_records.value, Some(1));
    assert_eq!(page.totals.unassigned_mcp_records.value, Some(0));
    assert_eq!(page.totals.record_count.value, Some(2));
    let skill = page
        .rows
        .iter()
        .find(|object| matches!(object.kind, UseObjectKind::Skill))
        .unwrap();
    assert_eq!(skill.associated_use_count.value, Some(1));
    assert_eq!(skill.use_count.value, None);
    assert_eq!(skill.coverage.time_gaps.value, Some(1));
    assert!(matches!(skill.state, UseState::Used));
    let mcp = page
        .rows
        .iter()
        .find(|object| matches!(object.kind, UseObjectKind::Mcp))
        .unwrap();
    assert_eq!(mcp.use_count.value, Some(1));
    let mut filtered = request(EvidenceSet::UseRecords, 1);
    if let Request::Evidence { object_ref, .. } = &mut filtered {
        *object_ref = Some(skill.object_ref.clone());
    }
    let Response::UseRecords(records) = run(&snapshot, &filtered) else {
        panic!()
    };
    assert_eq!(records.total.value, Some(1));
    assert_eq!(records.totals.record_count.value, Some(2));
    assert!(records.rows[0].timestamp_ms.is_none());
    assert!(matches!(records.rows[0].time_basis, UseTimeBasis::Unknown));
}
#[test]
fn object_sort_and_summary_pagination_keep_whole_turn_totals() {
    let mut operations = vec![];
    for index in 0..60 {
        let mut op = operation(&format!("read-{index}"), "skillRead")
            .as_ref()
            .clone();
        op.path = Some(format!("/synthetic/{index:03}/SKILL.md"));
        operations.push(Arc::new(op));
    }
    let mut retry = operations[59].as_ref().clone();
    retry.id = "retry".into();
    retry.call_id = Some("retry".into());
    operations.push(Arc::new(retry));
    let mut unknown = operation("unknown", "skillRead").as_ref().clone();
    unknown.call_id = None;
    unknown.path = Some("/synthetic/000-unknown/SKILL.md".into());
    operations.push(Arc::new(unknown));
    let snapshot = snapshot(operations);
    let cancel = AtomicBool::new(false);
    let evidence = snapshot
        .timing_evidence(target(), TimingReadBudget::default(), &cancel)
        .unwrap();
    let summary = summary(
        &snapshot,
        target(),
        Some(&evidence),
        PrivacyProfile::Local,
        &cancel,
    )
    .unwrap();
    assert_eq!(summary.objects.len(), 50);
    assert_eq!(summary.totals.object_count.value, Some(61));
    assert_eq!(summary.totals.record_count.value, Some(62));
    assert_eq!(
        summary.objects[0].path.as_deref(),
        Some("/synthetic/059/SKILL.md")
    );
    assert_eq!(summary.objects[0].associated_use_count.value, Some(2));
    assert_eq!(
        summary.objects[1].path.as_deref(),
        Some("/synthetic/000/SKILL.md")
    );
    let mut next = request(EvidenceSet::UseObjects, 200);
    if let Request::Evidence { cursor, .. } = &mut next {
        *cursor = summary.next_cursor;
    }
    let Response::UseObjects(page) = run(&snapshot, &next) else {
        panic!()
    };
    assert_eq!(page.total.value, Some(61));
    assert_eq!(page.rows.len(), 11);
    assert_eq!(page.rows[10].associated_use_count.value, None);
    assert!(matches!(page.rows[10].state, UseState::Used));
    assert!(page.next_cursor.is_none());
}
fn code(error: anyhow::Error) -> &'static str {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
}
#[test]
fn cursors_bind_view_source_turn_collection_object_and_method() {
    let snapshot = snapshot(vec![
        operation("one", "skillRead"),
        operation("two", "mcpTool"),
    ]);
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 1)) else {
        panic!()
    };
    let input_cursor = records.next_cursor.unwrap();
    for (field, value) in [
        ("snapshot", serde_json::json!("other")),
        ("schema", serde_json::json!(99)),
        ("source", serde_json::json!("other")),
        ("thread", serde_json::json!("other")),
        ("turn", serde_json::json!("other")),
        ("collection", serde_json::json!("use_objects")),
        ("object", serde_json::json!("use:other")),
        ("method", serde_json::json!(99)),
        ("offset", serde_json::json!(3)),
    ] {
        let bytes = input_cursor
            .token
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect::<Vec<_>>();
        let mut raw: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        raw[field] = value;
        let bytes = serde_json::to_vec(&raw).unwrap();
        let mut wrong = request(EvidenceSet::UseRecords, 1);
        if let Request::Evidence { cursor, .. } = &mut wrong {
            *cursor = Some(Cursor {
                token: bytes.iter().map(|b| format!("{b:02x}")).collect(),
            });
        }
        assert_eq!(
            code(
                super::super::query_on_snapshot(
                    &snapshot,
                    &wrong,
                    QueryFreshness::default(),
                    &AtomicBool::new(false)
                )
                .unwrap_err()
            ),
            "INVALID_ARGUMENT",
            "{field}"
        );
    }
    let mut wrong = request(EvidenceSet::UseObjects, 1);
    if let Request::Evidence { cursor, .. } = &mut wrong {
        *cursor = Some(input_cursor);
    }
    assert_eq!(
        code(
            super::super::query_on_snapshot(
                &snapshot,
                &wrong,
                QueryFreshness::default(),
                &AtomicBool::new(false)
            )
            .unwrap_err()
        ),
        "INVALID_ARGUMENT"
    );
    for mut invalid in [
        request(EvidenceSet::UseObjects, 0),
        request(EvidenceSet::UseObjects, 201),
        request(EvidenceSet::UseRecords, 1),
    ] {
        if let Request::Evidence {
            privacy_profile, ..
        } = &mut invalid
        {
            *privacy_profile = PrivacyProfile::ShareV1;
        }
        assert_eq!(
            code(super::super::validate(&invalid).unwrap_err()),
            "INVALID_ARGUMENT"
        );
    }
}
fn timed_data(operations: Vec<Arc<Operation>>) -> Collected {
    use crate::session_events::{Event, LifecycleKind, Payload, Phase, Position, Time};
    let mut collected = data(operations);
    collected.measurements.push(Arc::new(serde_json::from_value(serde_json::json!({"id":"measurement","agentKind":"codex","sourceInstanceId":"source","threadId":"thread","turnId":"turn","grain":"response","timePrecision":"unknown","model":{},"tokens":{"rawInput":50,"input":50},"requestScoped":true,"sequence":1,"evidence":[]})).unwrap()));
    for (offset, phase, time, duration) in [
        (1, Phase::Started, "2026-10-04T00:00:00Z", None),
        (2, Phase::Completed, "2026-10-04T00:00:01Z", Some(1000)),
    ] {
        collected.events.push(Arc::new(
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
                Time::from_source(Some(time)).0,
                vec![],
                Payload::Lifecycle {
                    lifecycle: LifecycleKind::Turn,
                    phase,
                    native_id: Some("native-turn".into()),
                    duration_ms: duration,
                    first_token_ms: None,
                },
            )
            .unwrap(),
        ));
    }
    collected
}
fn from_data(data: Collected) -> Snapshot {
    let root = tempfile::tempdir().unwrap();
    usage_store::memory(
        data,
        "live:uses".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap()
}
fn summary_request(profile: PrivacyProfile) -> Request {
    Request::Summary {
        thread_id: "thread".into(),
        turn_id: "turn".into(),
        snapshot_id: Some("live:uses".into()),
        roots: vec![],
        scope: None,
        mode: Mode::Cached,
        privacy_profile: profile,
    }
}
#[test]
fn oversized_use_target_omits_only_details_preserving_native_time_context_and_totals() {
    let mut op = operation("large", "skillRead").as_ref().clone();
    op.path = Some(format!(
        "/synthetic/{}/SKILL.md",
        "x".repeat(DETAIL_BYTES + 1)
    ));
    let snapshot = from_data(timed_data(vec![Arc::new(op)]));
    let Response::Local(local) = run(&snapshot, &summary_request(PrivacyProfile::Local)) else {
        panic!()
    };
    assert_eq!(local.time.native_wall_clock_ms.value, Some(1000));
    assert_eq!(local.context.input.median.value, Some(50.0));
    assert_eq!(local.uses.totals.object_count.value, Some(1));
    assert_eq!(local.uses.totals.record_count.value, Some(1));
    assert_eq!(local.uses.detail.reason, Basis::ResourceLimit);
    assert!(local.uses.objects.is_empty());
    assert!(local.uses.next_cursor.is_none());
    let Response::Share(share) = run(&snapshot, &summary_request(PrivacyProfile::ShareV1)) else {
        panic!()
    };
    assert_eq!(share.uses.object_count.value, Some(1));
    assert_eq!(share.time.native_wall_clock_ms.value, Some(1000));
    let text = serde_json::to_string(&share).unwrap();
    for forbidden in [
        "/synthetic",
        "objectRef",
        "server",
        "native-turn",
        "live:uses",
        "nextCursor",
        "\"path\":",
    ] {
        assert!(!text.contains(forbidden), "{forbidden}");
    }
}
#[test]
fn combined_summary_budget_drops_new_use_details_before_existing_verified_metrics() {
    let mut operations = vec![];
    for index in 0..50 {
        let mut op = operation(&format!("mcp-{index}"), "mcpTool")
            .as_ref()
            .clone();
        op.server = Some(format!("{index:03}{}", "x".repeat(1000)).into());
        operations.push(Arc::new(op));
    }
    let mut collected = timed_data(operations);
    collected
        .sources
        .push(crate::adapters::contract::SourceReport {
            source: crate::adapters::contract::SourceInstance {
                id: "source".into(),
                agent_kind: "codex".into(),
                root: "/synthetic/source".into(),
            },
            adapter_version: "x".repeat(180000),
            source_versions: vec![],
            capabilities: Default::default(),
            status: "complete".into(),
            files_read: 1,
            bytes_read: 1,
            issues: vec![],
        });
    let snapshot = from_data(collected);
    let cancel = AtomicBool::new(false);
    let evidence = snapshot
        .timing_evidence(target(), TimingReadBudget::default(), &cancel)
        .unwrap();
    let uses = summary(
        &snapshot,
        target(),
        Some(&evidence),
        PrivacyProfile::Local,
        &cancel,
    )
    .unwrap();
    assert_eq!(uses.objects.len(), 50);
    assert!(super::super::fits_limit(&uses, DETAIL_BYTES).unwrap());
    let Response::Local(local) = run(&snapshot, &summary_request(PrivacyProfile::Local)) else {
        panic!()
    };
    assert_eq!(local.time.native_wall_clock_ms.value, Some(1000));
    assert_eq!(local.context.input.median.value, Some(50.0));
    assert_eq!(local.uses.totals.object_count.value, Some(50));
    assert!(local.uses.objects.is_empty());
    assert_eq!(local.uses.detail.reason, Basis::ResourceLimit);
}
#[test]
fn known_empty_turn_is_an_observed_zero_but_unavailable_projection_is_unknown() {
    let snapshot = snapshot(vec![]);
    let cancel = AtomicBool::new(false);
    let evidence = snapshot
        .timing_evidence(target(), TimingReadBudget::default(), &cancel)
        .unwrap();
    let zero = summary(
        &snapshot,
        target(),
        Some(&evidence),
        PrivacyProfile::Local,
        &cancel,
    )
    .unwrap();
    assert_eq!(zero.totals.object_count.value, Some(0));
    assert_eq!(zero.totals.record_count.value, Some(0));
    assert!(matches!(
        zero.totals.source_coverage,
        UseSourceCoverage::Unknown
    ));
    let unknown = summary(&snapshot, target(), None, PrivacyProfile::Local, &cancel).unwrap();
    assert_eq!(unknown.totals.object_count.value, None);
    assert_eq!(unknown.totals.record_count.value, None);
    assert_eq!(unknown.detail.reason, Basis::ResourceLimit);
    assert_eq!(
        code(
            page(
                &snapshot,
                target(),
                LocalScope {
                    source_instance_id: "source".into(),
                    thread_id: "thread".into(),
                    turn_id: "turn".into(),
                    agent_kind: "codex".into(),
                    whole_turn: true
                },
                &request(EvidenceSet::UseObjects, 1),
                &AtomicBool::new(true)
            )
            .unwrap_err()
        ),
        "CANCELLED"
    );
}
#[test]
fn full_projection_budget_failure_preserves_other_verified_facts_without_prefix_counts() {
    // The source key is charged per inspected target, while canonical operations share
    // their owner. This can exhaust projection work before the storage byte/fact cap.
    let source = "s".repeat(1000);
    let operations = (0..70000)
        .map(|index| operation(&format!("op-{index}"), "skillRead"))
        .collect();
    let mut collected = timed_data(operations);
    collected.threads[0].source_instance_id = source.clone();
    let mut measurement = collected.measurements[0].as_ref().clone();
    measurement.source_instance_id = source.as_str().into();
    collected.measurements[0] = Arc::new(measurement);
    collected.events = collected
        .events
        .into_iter()
        .map(|event| {
            let mut position = event.position().clone();
            position.source_instance_id = source.clone();
            Arc::new(
                crate::session_events::Event::new(
                    position,
                    Some("thread".into()),
                    Some("turn".into()),
                    event.time().clone(),
                    vec![],
                    event.payload().clone(),
                )
                .unwrap(),
            )
        })
        .collect();
    let snapshot = from_data(collected);
    let Response::Local(local) = run(&snapshot, &summary_request(PrivacyProfile::Local)) else {
        panic!()
    };
    assert_eq!(local.time.native_wall_clock_ms.value, Some(1000));
    assert_eq!(local.context.input.median.value, Some(50.0));
    assert_eq!(local.uses.totals.object_count.value, None);
    assert_eq!(local.uses.totals.record_count.value, None);
    assert!(local.uses.objects.is_empty());
    assert_eq!(local.uses.detail.reason, Basis::ResourceLimit);
}

#[test]
fn multiple_native_read_targets_share_one_record_and_filtered_object_reference() {
    use crate::adapters::contract::{
        CommandSource, ParsedCommand, WORK_OBSERVATION_VERSION, WorkData, WorkObservation,
        WorkStage,
    };
    let mut op = operation("multi", "command").as_ref().clone();
    op.path = None;
    op.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: WorkStage::Terminal,
        data: WorkData::Command {
            cwd: Some("file:///synthetic".into()),
            source: Some(CommandSource::Agent),
            parsed_commands: Some(vec![
                ParsedCommand::Read {
                    path: Some("/synthetic/one/SKILL.md".into()),
                },
                ParsedCommand::Read {
                    path: Some("/synthetic/two/SKILL.md".into()),
                },
            ]),
        },
        gaps: vec![],
    });
    let snapshot = snapshot(vec![Arc::new(op)]);
    let Response::UseObjects(objects) = run(&snapshot, &request(EvidenceSet::UseObjects, 200))
    else {
        panic!()
    };
    assert_eq!(objects.rows.len(), 2);
    assert_eq!(objects.totals.record_count.value, Some(1));
    let Response::Local(summary) = run(&snapshot, &summary_request(PrivacyProfile::Local)) else {
        panic!()
    };
    assert_eq!(summary.work.operation_candidates.value, Some(1));
    assert_eq!(summary.work.closed_operations.value, Some(1));
    assert_eq!(summary.work.failed_operations.value, Some(0));
    assert!(
        summary
            .uses
            .objects
            .iter()
            .all(|object| object.use_count.value.is_none())
    );
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 200))
    else {
        panic!()
    };
    assert_eq!(records.rows.len(), 1);
    assert!(records.rows[0].object_ref.is_none());
    assert!(matches!(records.rows[0].state, UseState::Candidate));
    assert!(!records.rows[0].gap_codes.contains(&"missing_target".into()));
    for object in objects.rows {
        let mut request = request(EvidenceSet::UseRecords, 200);
        if let Request::Evidence { object_ref, .. } = &mut request {
            *object_ref = Some(object.object_ref.clone());
        }
        let Response::UseRecords(filtered) = run(&snapshot, &request) else {
            panic!()
        };
        assert_eq!(filtered.rows.len(), 1);
        assert_eq!(filtered.rows[0].reference, records.rows[0].reference);
        assert_eq!(filtered.rows[0].object_ref, Some(object.object_ref));
        assert_eq!(filtered.total.value, Some(1));
        assert_eq!(filtered.totals.record_count.value, Some(1));
    }
}

#[test]
fn mixed_known_and_missing_native_read_targets_keep_record_gap_on_filtered_pages() {
    use crate::adapters::contract::{
        CommandSource, ParsedCommand, WORK_OBSERVATION_VERSION, WorkData, WorkObservation,
        WorkStage,
    };
    let mut op = operation("mixed", "command").as_ref().clone();
    op.path = None;
    op.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: WorkStage::Terminal,
        data: WorkData::Command {
            cwd: Some("file:///synthetic".into()),
            source: Some(CommandSource::Agent),
            parsed_commands: Some(vec![
                ParsedCommand::Read {
                    path: Some("/synthetic/one/SKILL.md".into()),
                },
                ParsedCommand::Read { path: None },
            ]),
        },
        gaps: vec![crate::adapters::contract::WorkGap::MissingReadPath],
    });
    let snapshot = snapshot(vec![Arc::new(op)]);
    let Response::UseObjects(objects) = run(&snapshot, &request(EvidenceSet::UseObjects, 200))
    else {
        panic!()
    };
    assert_eq!(objects.rows.len(), 1);
    let Response::UseRecords(records) = run(&snapshot, &request(EvidenceSet::UseRecords, 200))
    else {
        panic!()
    };
    assert_eq!(records.rows.len(), 1);
    assert!(records.rows[0].gap_codes.contains(&"missing_target".into()));
    let mut filtered_request = request(EvidenceSet::UseRecords, 200);
    if let Request::Evidence { object_ref, .. } = &mut filtered_request {
        *object_ref = Some(objects.rows[0].object_ref.clone());
    }
    let Response::UseRecords(filtered) = run(&snapshot, &filtered_request) else {
        panic!()
    };
    assert_eq!(filtered.rows.len(), 1);
    assert!(
        filtered.rows[0]
            .gap_codes
            .contains(&"missing_target".into())
    );
    assert_eq!(filtered.rows[0].reference, records.rows[0].reference);
    assert_eq!(
        filtered.rows[0].object_ref,
        Some(objects.rows[0].object_ref.clone())
    );
}
