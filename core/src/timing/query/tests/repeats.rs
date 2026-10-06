use super::*;
use crate::adapters::contract::{OPERATION_MATCH_VERSION, Operation, WORK_OBSERVATION_VERSION};
fn command(
    offset: u64,
    id: &str,
    start: Option<i64>,
    end: Option<i64>,
    status: &str,
    native: Option<u64>,
) -> Vec<Arc<Event>> {
    [ (Phase::Started,start,"running"), (if status=="failed" {Phase::Failed} else {Phase::Completed},end,status) ]
        .into_iter().enumerate().map(|(i,(phase,time,status))|{
        let op:Operation=serde_json::from_value(serde_json::json!({
            "id":id,"threadId":"thread-private","turnId":"turn-private","itemId":id,
            "kind":"command","name":"command","sequence":offset+i as u64,
            "timePrecision":"unknown","status":status,"outcomeConflict":false,
            "durationMs":if i==1 {native} else {None},"evidence":[],
            "work":{"formatVersion":WORK_OBSERVATION_VERSION,"stage":if i==0 {"proposed"} else {"terminal"},"gaps":[],
            "data":{"kind":"command","cwd":"/private-repeated-target","source":"agent","parsed_commands":[{"kind":"read","path":"a.txt"}]}},
            "matching":{"formatVersion":OPERATION_MATCH_VERSION,"receiverOwner":"thread-private",
                "requestFingerprint":crate::hash("private-full-request"),"readTargets":[{"path":"/private-repeated-target/a.txt","platform":"posix"}],"expectedNonzero":false,"gaps":[]}
        })).unwrap();
        event(offset+i as u64,time,Payload::Operation{value:Arc::new(op),phase})
    }).collect()
}
fn commands(timed: bool) -> Vec<Arc<Event>> {
    let time = |v| timed.then_some(v);
    let mut events = vec![boundary(0, time(0), Phase::Started, None, None)];
    events.extend(command(
        1,
        "private-success",
        time(10),
        time(20),
        "completed",
        None,
    ));
    events.extend(command(
        3,
        "private-failure",
        time(30),
        time(40),
        "failed",
        None,
    ));
    events.extend(command(
        5,
        "private-later",
        time(50),
        time(80),
        "completed",
        Some(40),
    ));
    events.push(boundary(7, time(100), Phase::Completed, None, None));
    events
}
#[test]
fn repeat_aggregate_retains_counts_native_subtotals_and_deduplicated_union() {
    let snapshot = make_snapshot(commands(true));
    let local = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let r = &local.time.repeated_behavior;
    assert_eq!(r.after_failure.count.value, Some(1));
    assert_eq!(r.after_failure.count.basis, Basis::RepeatAfterFailure);
    assert_eq!(r.repeated_read.count.value, Some(2));
    assert_eq!(r.repeated_read.duration.known_sum_ms.value, Some(50));
    assert_eq!(r.repeated_read.duration.recorded_count.value, Some(1));
    assert_eq!(r.repeated_read.duration.calculated_count.value, Some(1));
    assert_eq!(r.same_request_observation_count.value, Some(2));
    assert_eq!(r.repeated_read_request_count.value, Some(2));
    assert_eq!(r.combined_operation_count.value, Some(2));
    assert_eq!(r.combined_union_ms.value, Some(40));
    assert_eq!(r.recovery_span_sum_ms.value, Some(40));
    let Response::Share(s) = query(&snapshot, &request(PrivacyProfile::ShareV1)) else {
        panic!()
    };
    assert_eq!(
        s.time
            .repeated_behavior
            .repeated_read
            .duration
            .known_sum_ms
            .value,
        Some(50)
    );
    assert_ne!(
        s.time.repeated_behavior.after_failure.count.evidence_refs,
        r.after_failure.count.evidence_refs
    );
    let text = serde_json::to_string(&s).unwrap();
    for secret in [
        "private-success",
        "private-failure",
        "private-later",
        "private-repeated-target",
        &crate::hash("private-full-request"),
        "thread-private",
        "source-private",
    ] {
        assert!(!text.contains(secret), "{secret}");
    }
    assert!(!text.contains("requestFingerprint"));
}
#[test]
fn repeat_aggregate_without_time_keeps_source_order_observations_and_explanations() {
    let snapshot = make_snapshot(commands(false));
    let r = local(query(&snapshot, &request(PrivacyProfile::Local)))
        .time
        .repeated_behavior;
    assert_eq!(r.same_request_observation_count.value, Some(2));
    assert_eq!(r.repeated_read_request_count.value, Some(2));
    assert_eq!(r.after_failure.count.value, Some(0));
    assert_eq!(r.combined_union_ms.value, None);
    assert!(r.coverage.partial);
    assert!(
        r.coverage
            .reason_codes
            .contains(&RepeatCoverageReason::MissingStart)
    );
    assert!(
        r.coverage
            .reason_codes
            .contains(&RepeatCoverageReason::MissingWindow)
    );
}
#[test]
fn repeat_aggregate_preserves_positive_subtotals_with_source_gap() {
    let mut collected = data(commands(true));
    collected.sources[0].status = "partial".into();
    let root = tempfile::tempdir().unwrap();
    let snapshot = usage_store::memory(
        collected,
        "live:private".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap();
    let r = local(query(&snapshot, &request(PrivacyProfile::Local)))
        .time
        .repeated_behavior;
    assert_eq!(r.after_failure.count.value, Some(1));
    assert_eq!(r.after_failure.duration.known_sum_ms.value, Some(40));
    assert!(r.coverage.partial);
    assert!(
        r.coverage
            .reason_codes
            .contains(&RepeatCoverageReason::SourcePartial)
    );
    assert!(matches!(r.support.support, Support::Partial));
}
#[test]
fn repeat_aggregate_unsafe_duration_is_absent_without_erasing_counts() {
    let mut events = commands(true);
    events[6] = command(
        5,
        "private-later",
        Some(50),
        Some(80),
        "completed",
        Some(u64::MAX),
    )
    .pop()
    .unwrap();
    let r = local(query(
        &make_snapshot(events),
        &request(PrivacyProfile::Local),
    ))
    .time
    .repeated_behavior;
    assert_eq!(r.after_failure.count.value, Some(1));
    assert_eq!(r.after_failure.duration.known_sum_ms.value, None);
    assert_eq!(
        r.after_failure.duration.known_sum_ms.basis,
        Basis::NumericRange
    );
    assert_eq!(r.repeated_read.duration.known_sum_ms.value, None);
    assert!(
        r.coverage
            .reason_codes
            .contains(&RepeatCoverageReason::NumericRange)
    );
    assert_eq!(r.combined_union_ms.value, Some(40));
}

#[test]
fn native_mcp_aggregates_reach_local_and_share_without_command_or_read_counts() {
    let events: Vec<_> = commands(true)
        .into_iter()
        .map(|e| {
            let mut value = serde_json::to_value(&e).unwrap();
            if value["payload"]["value"]["kind"] == "command" {
                let op = &mut value["payload"]["value"];
                op["kind"] = serde_json::json!("mcpTool");
                op["server"] = serde_json::json!("PRIVATE_SERVER");
                op["tool"] = serde_json::json!("PRIVATE_TOOL");
                op["work"] = serde_json::Value::Null;
                op["matching"]["readTargets"] = serde_json::json!([]);
            }
            Arc::new(serde_json::from_value(value).unwrap())
        })
        .collect();
    let snapshot = make_snapshot(events);
    let result = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let repeats = &result.time.repeated_behavior;
    assert_eq!(repeats.after_failure.count.value, Some(1));
    assert_eq!(repeats.after_failure.duration.known_sum_ms.value, Some(40));
    assert_eq!(repeats.same_request_observation_count.value, Some(2));
    assert_eq!(repeats.coverage.eligible_commands.value, Some(0));
    assert_eq!(repeats.repeated_read.count.value, Some(0));
    let Response::Share(shared) = query(&snapshot, &request(PrivacyProfile::ShareV1)) else {
        panic!()
    };
    assert_eq!(
        shared.time.repeated_behavior.after_failure.count.value,
        Some(1)
    );
    let encoded = serde_json::to_string(&shared).unwrap();
    for field in [
        "PRIVATE_SERVER",
        "PRIVATE_TOOL",
        "requestFingerprint",
        "receiverOwner",
        "readTargets",
    ] {
        assert!(!encoded.contains(field), "{field}");
    }
}

#[test]
fn predecessor_navigation_separates_each_proof_and_reads_the_fixed_pages() {
    let events = commands(true);
    let snapshot = make_snapshot(events.clone());
    let response = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let navigation = &response.evidence.repeat_pages;
    assert_eq!(navigation.candidate_operation_count.value, Some(2));
    assert_eq!(navigation.located_operation_count.value, Some(2));
    assert_eq!(navigation.entries.len(), 2);
    let later = &navigation.entries[1];
    assert_eq!(later.later.operation_alias, "repeat:1:later");
    assert!(later.after_failure.is_some());
    assert_eq!(later.successful_reads.len(), 1);
    assert_eq!(later.later_duration_ms.value, Some(40));
    for (proof, expected) in [
        (&later.later, vec![events[5].id(), events[6].id()]),
        (
            later.after_failure.as_ref().unwrap(),
            vec![events[3].id(), events[4].id()],
        ),
        (
            &later.successful_reads[0],
            vec![events[1].id(), events[2].id()],
        ),
    ] {
        let references: Vec<_> = proof
            .pages
            .iter()
            .flat_map(|p| p.evidence_refs.iter())
            .collect();
        for id in expected {
            assert!(references.contains(&&format!("event:{id}")));
        }
        for page in &proof.pages {
            let Request::Summary {
                thread_id,
                turn_id,
                snapshot_id,
                roots,
                scope,
                ..
            } = request(PrivacyProfile::Local)
            else {
                panic!()
            };
            let evidence_request = Request::Evidence {
                thread_id,
                turn_id,
                snapshot_id: snapshot_id.unwrap(),
                roots,
                scope,
                cursor: page.cursor.clone(),
                limit: page.limit,
                privacy_profile: PrivacyProfile::Local,
                collection: EvidenceSet::TurnEvents,
                object_ref: None,
            };
            let Response::Evidence(page_result) = query(&snapshot, &evidence_request) else {
                panic!()
            };
            for reference in &page.evidence_refs {
                assert!(
                    page_result
                        .rows
                        .iter()
                        .any(|row| &row.reference == reference)
                );
            }
        }
    }
    let Response::Share(shared) = query(&snapshot, &request(PrivacyProfile::ShareV1)) else {
        panic!()
    };
    let text = serde_json::to_string(&shared).unwrap();
    for field in [
        "repeatPages",
        "operationAlias",
        "successfulReads",
        "cursor",
        "repeat:1",
    ] {
        assert!(!text.contains(field), "{field}");
    }
}

#[test]
fn repeat_proofs_locate_later_pages_and_do_not_reuse_the_first_page() {
    let mut events = vec![boundary(0, Some(0), Phase::Started, None, None)];
    events.extend(command(
        1,
        "private-success",
        Some(10),
        Some(20),
        "completed",
        None,
    ));
    for offset in 3..250 {
        events.push(event(
            offset,
            None,
            Payload::ContextWindow {
                tokens: 4096,
                model: None,
            },
        ));
    }
    events.extend(command(
        250,
        "private-failure",
        Some(30),
        Some(40),
        "failed",
        None,
    ));
    events.extend(command(
        252,
        "private-later",
        Some(50),
        Some(80),
        "completed",
        Some(40),
    ));
    events.push(boundary(254, Some(100), Phase::Completed, None, None));
    let snapshot = make_snapshot(events);
    let local = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let last = &local.evidence.repeat_pages.entries[1];
    assert!(last.later.pages[0].cursor.is_some());
    assert!(
        last.after_failure.as_ref().unwrap().pages[0]
            .cursor
            .is_some()
    );
    assert!(last.successful_reads[0].pages[0].cursor.is_none());
}

#[test]
fn navigation_encoding_bounds_drop_details_only_and_preserve_complete_counts() {
    let events = commands(true);
    let snapshot = make_snapshot(events.clone());
    let analysis = analysis::analyze(analysis::AnalyzeInput {
        source: "source-private",
        thread: "thread-private",
        turn: "turn-private",
        measurements: &[],
        events: &events,
        budget: analysis::Budget {
            events: 100_000,
            measurements: 100_000,
            lifecycle_records: 100_000,
        },
    });
    let target = TurnTarget {
        source: "source-private",
        thread: "thread-private",
        turn: "turn-private",
    };
    let build = |budget| {
        super::super::repeats::build_budget(
            &snapshot,
            target,
            &analysis.repeated_behavior,
            Some(&events),
            None,
            budget,
            &AtomicBool::new(false),
        )
        .unwrap()
    };
    let full = build(navigation::LIMIT_BYTES);
    let bytes = serde_json::to_vec(&full).unwrap().len();
    let exact = build(bytes);
    assert_eq!(exact.entries.len(), 2);
    let limited = build(bytes - 1);
    assert!(limited.entries.is_empty());
    assert_eq!(limited.detail.reason, Basis::ResourceLimit);
    assert_eq!(
        limited.candidate_operation_count.value,
        full.candidate_operation_count.value
    );
    assert_eq!(
        limited.located_operation_count.value,
        full.located_operation_count.value
    );
    assert_eq!(limited.page_count.value, full.page_count.value);
}

#[test]
fn native_endpoint_proofs_keep_matching_and_duration_witnesses() {
    let mut events = commands(true);
    let native = event(
        7,
        None,
        Payload::Item {
            item_kind: crate::session_events::ItemKind::Command,
            native_id: Some("private-later".into()),
            phase: Phase::Completed,
            started_at_ms: Some(50),
            completed_at_ms: Some(80),
            duration: None,
        },
    );
    let native_id = native.id().to_owned();
    events.pop();
    events.push(native);
    events.push(boundary(8, Some(100), Phase::Completed, None, None));
    let snapshot = make_snapshot(events.clone());
    let local = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let last = &local.evidence.repeat_pages.entries[1].later;
    let refs: Vec<_> = last
        .pages
        .iter()
        .flat_map(|p| p.evidence_refs.iter())
        .collect();
    for id in [native_id, events[5].id().into(), events[6].id().into()] {
        assert!(refs.contains(&&format!("event:{id}")));
    }
}

#[test]
fn activity_checks_consume_fixed_analysis_without_relabeling_request_order() {
    use crate::optimize_dto::{ActivityRule, RuleOutcome};
    for timed in [true, false] {
        let snapshot = make_snapshot(commands(timed));
        let summary = local(query(&snapshot, &request(PrivacyProfile::Local)));
        let inspection = crate::optimize::activity::evaluate(&summary);
        assert_eq!(
            inspection.read_view.snapshot_id,
            summary.read_view.snapshot_id
        );
        assert_eq!(inspection.scope.turn_id, summary.scope.turn_id);
        assert_eq!(inspection.checks[2].observed.value, Some(2));
        assert_eq!(inspection.checks[2].outcome, RuleOutcome::Hit);
        if timed {
            assert_eq!(inspection.checks[0].observed.value, Some(1));
            assert_eq!(inspection.checks[1].observed.value, Some(2));
            assert_eq!(
                inspection.advice,
                vec![
                    ActivityRule::InspectCallsAfterFailure,
                    ActivityRule::InspectRepeatedReads
                ]
            );
            let mut partial = summary;
            partial.coverage.source_status = "partial".into();
            partial.work.outcomes.partial = true;
            let partial = crate::optimize::activity::evaluate(&partial);
            assert!(
                partial.checks[..3]
                    .iter()
                    .all(|check| check.partial && check.outcome == RuleOutcome::Hit)
            );
            assert!(partial.checks[3].partial);
            assert_eq!(partial.checks[3].outcome, RuleOutcome::Insufficient);
        } else {
            assert_eq!(inspection.checks[0].outcome, RuleOutcome::Insufficient);
            assert_eq!(inspection.checks[1].outcome, RuleOutcome::Insufficient);
            assert_eq!(
                inspection.advice,
                vec![ActivityRule::InspectRepeatedRequests]
            );
        }
    }
}

#[test]
fn callable_matching_reaches_shared_inspection_and_safe_aggregates_without_raw_digests() {
    let events: Vec<_> = commands(true)
        .into_iter()
        .map(|e| {
            let mut value = serde_json::to_value(e).unwrap();
            if value["payload"]["value"]["kind"] == "command" {
                let op = &mut value["payload"]["value"];
                op["kind"] = serde_json::json!("mcp");
                op["work"] = serde_json::Value::Null;
                op["matching"]["readTargets"] = serde_json::json!([]);
                op["matching"]["functionRequestFingerprint"] =
                    serde_json::json!(crate::hash("PRIVATE_CALLABLE"));
                op["matching"]["requestFingerprint"] = serde_json::Value::Null;
            }
            Arc::new(serde_json::from_value(value).unwrap())
        })
        .collect();
    let snapshot = make_snapshot(events);
    let summary = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(
        summary
            .time
            .repeated_behavior
            .same_request_observation_count
            .value,
        Some(2)
    );
    assert_eq!(
        summary.time.repeated_behavior.after_failure.count.value,
        Some(1)
    );
    let inspected = crate::optimize::activity::evaluate(&summary);
    assert_eq!(
        inspected.advice,
        vec![crate::optimize_dto::ActivityRule::InspectCallsAfterFailure]
    );
    let shared = query(&snapshot, &request(PrivacyProfile::ShareV1));
    for encoded in [
        serde_json::to_string(&summary).unwrap(),
        serde_json::to_string(&inspected).unwrap(),
        serde_json::to_string(&shared).unwrap(),
    ] {
        for private in [
            "functionRequestFingerprint",
            "requestFingerprint",
            "PRIVATE_CALLABLE",
            &crate::hash("PRIVATE_CALLABLE"),
        ] {
            assert!(!encoded.contains(private));
        }
    }
}

#[test]
fn failure_share_advice_uses_the_fixed_shared_outcome_subset() {
    use crate::optimize_dto::{ActivityRule, RuleOutcome};
    let mut events = commands(true);
    events.pop();
    events.extend(command(
        7,
        "later-failure-one",
        Some(85),
        Some(90),
        "failed",
        None,
    ));
    events.extend(command(
        9,
        "later-failure-two",
        Some(95),
        Some(100),
        "failed",
        None,
    ));
    events.push(boundary(11, Some(200), Phase::Completed, None, None));
    let canonical = events
        .iter()
        .filter_map(|event| match event.payload() {
            Payload::Operation {
                value,
                phase: Phase::Completed | Phase::Failed,
            } => Some(value.clone()),
            _ => None,
        })
        .collect();
    let snapshot = work_snapshot(canonical, events, false);
    let summary = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let inspected = crate::optimize::activity::evaluate(&summary);
    let check = &inspected.checks[3];
    assert_eq!(check.rule, ActivityRule::InspectFailureShare);
    assert_eq!(check.outcome, RuleOutcome::Hit);
    let facts = check.outcomes.as_ref().unwrap();
    assert_eq!(facts.determinate_operations.value, Some(5));
    assert_eq!(facts.failed.value, Some(3));
    assert_eq!(facts.failure_ratio.value, Some(0.6));
    assert_eq!(
        facts.failure_ratio.value,
        summary.work.outcomes.failure_ratio.value
    );
    assert_eq!(
        inspected.read_view.snapshot_id,
        summary.read_view.snapshot_id
    );
    assert!(
        inspected
            .advice
            .contains(&ActivityRule::InspectFailureShare)
    );
}
