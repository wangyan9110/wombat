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
