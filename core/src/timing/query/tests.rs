use super::*;
use crate::adapters::contract::{
    Collected, SourceInstance, SourceReport, SourceWatermark, Thread, Turn, WatermarkState,
};
use crate::session_events::{
    ContentPhase, ContentPresence, LifecycleKind, MessageRecordKind, Phase, Position,
    Time as EventTime,
};
fn event(offset: u64, time: Option<i64>, payload: Payload) -> Arc<Event> {
    let time = time.map(|ms| {
        chrono::DateTime::from_timestamp_millis(ms)
            .unwrap()
            .to_rfc3339()
    });
    Arc::new(
        Event::new(
            Position {
                source_instance_id: "source-private".into(),
                file_id: "file-private".into(),
                generation: "generation-private".into(),
                byte_offset: offset,
                ordinal: 0,
            },
            Some("thread-private".into()),
            Some("turn-private".into()),
            EventTime::from_source(time.as_deref()).0,
            vec![],
            payload,
        )
        .unwrap(),
    )
}
fn boundary(
    offset: u64,
    time: Option<i64>,
    phase: Phase,
    duration: Option<u64>,
    ttft: Option<u64>,
) -> Arc<Event> {
    event(
        offset,
        time,
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Turn,
            phase,
            native_id: Some("native-private".into()),
            duration_ms: duration,
            first_token_ms: ttft,
        },
    )
}
fn data(events: Vec<Arc<Event>>) -> Collected {
    Collected {
        threads: vec![Thread {
            id: "thread-private".into(),
            agent_kind: "codex".into(),
            source_instance_id: "source-private".into(),
            upstream_id: "upstream-private".into(),
            title: Some("title-private".into()),
            project: Some("/project-private".into()),
            started_at: None,
            last_activity_at: None,
        }],
        turns: vec![Turn {
            id: "turn-private".into(),
            thread_id: "thread-private".into(),
            upstream_id: "native-private".into(),
            ordinal: 1,
            started_at: None,
            ended_at: None,
            last_activity_at: None,
            status: "completed".into(),
        }],
        sources: vec![SourceReport {
            source: SourceInstance {
                id: "source-private".into(),
                agent_kind: "codex".into(),
                root: "/root-private".into(),
            },
            adapter_version: "codex-rollout-6".into(),
            source_versions: vec![],
            capabilities: Default::default(),
            status: "complete".into(),
            files_read: 1,
            bytes_read: 100,
            issues: vec![],
        }],
        watermarks: vec![SourceWatermark {
            format_version: 1,
            source_instance_id: "source-private".into(),
            file_id: "file-private".into(),
            generation: Some("generation-private".into()),
            committed_offset: 200_000,
            observed_bytes: Some(200_000),
            observed_at: "2026-10-01T00:00:00Z".into(),
            state: WatermarkState::Complete,
            issue_codes: vec![],
        }],
        events,
        ..Default::default()
    }
}
fn make_snapshot(events: Vec<Arc<Event>>) -> Snapshot {
    let root = tempfile::tempdir().unwrap();
    usage_store::memory(
        data(events),
        "live:private".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap()
}
fn request(profile: PrivacyProfile) -> Request {
    Request::Summary {
        thread_id: "thread-private".into(),
        turn_id: "turn-private".into(),
        snapshot_id: Some("live:private".into()),
        roots: vec![],
        scope: None,
        mode: Mode::Cached,
        privacy_profile: profile,
    }
}
fn query(snapshot: &Snapshot, request: &Request) -> Response {
    query_on_snapshot(
        snapshot,
        request,
        QueryFreshness {
            status: "cached".into(),
            ..Default::default()
        },
        &AtomicBool::new(false),
    )
    .unwrap()
}
fn local(response: Response) -> LocalResponse {
    match response {
        Response::Local(response) => *response,
        _ => panic!(),
    }
}
fn error_code(error: anyhow::Error) -> String {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
        .into()
}
fn complete_events() -> Vec<Arc<Event>> {
    vec![
        boundary(0, Some(1_000), Phase::Started, None, None),
        event(
            1,
            Some(1_050),
            Payload::Message {
                origin: MessageOrigin::AssistantVisible,
                presence: ContentPresence::NonEmpty,
                native_id: Some("message-private".into()),
                record_kind: MessageRecordKind::LegacySnapshot,
                record_phase: Phase::Completed,
                content_phase: ContentPhase::FinalAnswer,
            },
        ),
        boundary(2, Some(1_100), Phase::Completed, Some(120), Some(0)),
    ]
}
#[test]
fn full_local_metrics_and_share_aliases_are_independent_whitelists() {
    let snapshot = make_snapshot(complete_events());
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.time.native_wall_clock_ms.value, Some(120));
    assert_eq!(l.time.derived_wall_clock_ms.value, Some(100));
    assert_eq!(l.time.native_ttft_ms.value, Some(0));
    assert_eq!(l.time.first_content_record_delay_ms.value, Some(50));
    assert_eq!(
        l.time.first_content_record_delay_ms.status,
        MetricStatus::Derived
    );
    assert_eq!(
        l.time.strict_response_gap_ms.basis,
        Basis::MissingBatchCycle
    );
    assert_eq!(l.work.operation_candidates.basis, Basis::AdapterNotMapped);
    assert_eq!(l.context.active_context_occupancy.value, None);
    assert_eq!(l.evidence.collections.len(), 4);
    assert!(
        l.time
            .native_wall_clock_ms
            .evidence_refs
            .iter()
            .all(|id| id.starts_with("collection:"))
    );
    let a = query(&snapshot, &request(PrivacyProfile::ShareV1));
    let b = query(&snapshot, &request(PrivacyProfile::ShareV1));
    let a_json = serde_json::to_value(&a).unwrap();
    let b_json = serde_json::to_value(&b).unwrap();
    assert_ne!(a_json["scope"], b_json["scope"]);
    let bytes = serde_json::to_string(&a).unwrap();
    for secret in [
        "source-private",
        "thread-private",
        "turn-private",
        "file-private",
        "generation-private",
        "upstream-private",
        "title-private",
        "/root-private",
        "/project-private",
        "live:private",
        "native-private",
        "message-private",
        "2026-10-01",
        "1970-01-01",
    ] {
        assert!(!bytes.contains(secret), "{secret}");
    }
    assert!(a_json.get("readView").is_none());
    assert!(a_json.get("evidence").is_none());
    assert_eq!(a_json["relativeAnchors"]["startMs"]["value"], 0);
    assert_eq!(a_json["relativeAnchors"]["endMs"]["value"], 100);
    assert_eq!(a_json["time"]["nativeWallClockMs"]["value"], 120);
    assert!(fits(&a).unwrap());
}
#[test]
fn request_union_is_narrow_and_capabilities_need_no_snapshot() {
    for value in [
        serde_json::json!({"action":"capabilities","roots":["/private"]}),
        serde_json::json!({"action":"summary","threadId":"t","turnId":"r","verify":true}),
        serde_json::json!({"action":"evidence","threadId":"t","turnId":"r","snapshotId":"s","mode":"fresh"}),
        serde_json::json!({"action":"summary","threadId":"t","turnId":"r","scope":{"since":"2026-01-01"}}),
    ] {
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
    let capabilities: Request =
        serde_json::from_value(serde_json::json!({"action":"capabilities"})).unwrap();
    assert!(matches!(
        dispatch(capabilities).unwrap(),
        Response::Capabilities(_)
    ));
    let mut invalid_request = request(PrivacyProfile::Local);
    if let Request::Summary { mode, .. } = &mut invalid_request {
        *mode = Mode::Fresh;
    }
    assert_eq!(
        error_code(validate(&invalid_request).unwrap_err()),
        "INVALID_ARGUMENT"
    );
    let schema = crate::dispatch("schema_timing_request", &serde_json::json!({})).unwrap();
    assert!(schema.to_string().contains("additionalProperties"));
}
#[test]
fn evidence_pages_keep_whole_denominator_and_bind_target_and_snapshot() {
    let snapshot = make_snapshot(complete_events());
    let r = Request::Evidence {
        thread_id: "thread-private".into(),
        turn_id: "turn-private".into(),
        snapshot_id: "live:private".into(),
        roots: vec![],
        scope: None,
        cursor: None,
        limit: 1,
        privacy_profile: PrivacyProfile::Local,
    };
    let Response::Evidence(first) = query(&snapshot, &r) else {
        panic!()
    };
    assert_eq!(first.total.value, Some(3));
    assert_eq!(first.rows.len(), 1);
    assert!(first.rows[0].reference.starts_with("event:"));
    let mut next = r.clone();
    if let Request::Evidence { cursor, .. } = &mut next {
        *cursor = first.next_cursor.clone();
    }
    let Response::Evidence(second) = query(&snapshot, &next) else {
        panic!()
    };
    assert_eq!(second.total.value, Some(3));
    assert_ne!(first.rows[0].reference, second.rows[0].reference);
    let mut stale = next.clone();
    if let Request::Evidence { snapshot_id, .. } = &mut stale {
        *snapshot_id = "other-view".into();
    }
    assert_eq!(
        error_code(
            query_on_snapshot(
                &snapshot,
                &stale,
                Default::default(),
                &AtomicBool::new(false)
            )
            .unwrap_err()
        ),
        "VIEW_EXPIRED"
    );
    if let Request::Evidence { turn_id, .. } = &mut next {
        *turn_id = "other-turn".into();
    }
    assert!(
        query_on_snapshot(
            &snapshot,
            &next,
            Default::default(),
            &AtomicBool::new(false)
        )
        .is_err()
    );
    for token in ["00".repeat(4097), "z".into(), "000".into()] {
        assert!(decode_cursor(&Cursor { token }).is_err());
    }
}
#[test]
fn evidence_numeric_range_is_distinct_from_missing_and_zero() {
    let huge = boundary(0, Some(0), Phase::Completed, Some(u64::MAX), Some(0));
    let row = evidence_row(&huge).unwrap();
    assert_eq!(row.duration_ms, None);
    assert_eq!(row.first_token_ms, Some(0));
    assert!(row.gap_codes.iter().any(|code| code == "numeric_range"));
    let snapshot = make_snapshot(vec![huge]);
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.time.native_wall_clock_ms.basis, Basis::NumericRange);
    assert!(l.quality.reason_codes.contains(&Basis::NumericRange));
}
#[test]
fn source_membership_snapshot_identity_and_cancellation_reject_safely() {
    let snapshot = make_snapshot(complete_events());
    let mut r = request(PrivacyProfile::Local);
    if let Request::Summary { scope, .. } = &mut r {
        *scope = Some(Scope {
            source_instance_id: Some("elsewhere".into()),
            agent_kind: None,
        });
    }
    assert_eq!(
        error_code(
            query_on_snapshot(&snapshot, &r, Default::default(), &AtomicBool::new(false))
                .unwrap_err()
        ),
        "INVALID_ARGUMENT"
    );
    assert_eq!(
        error_code(
            query_on_snapshot(
                &snapshot,
                &request(PrivacyProfile::Local),
                Default::default(),
                &AtomicBool::new(true)
            )
            .unwrap_err()
        ),
        "CANCELLED"
    );
    let safe = error_output(&operation_error(
        "SOURCE_UNREADABLE",
        "secret /private/raw-json",
    ));
    assert!(!serde_json::to_string(&safe).unwrap().contains("private"));
}
#[test]
fn native_fallback_reduces_complete_partition_including_final_conflict() {
    let mut events = Vec::with_capacity(100_001);
    events.push(boundary(0, None, Phase::Started, None, None));
    for offset in 1..100_000 {
        events.push(boundary(offset, None, Phase::Completed, Some(42), Some(5)));
    }
    events.push(boundary(100_000, None, Phase::Completed, Some(43), Some(5)));
    let snapshot = make_snapshot(events);
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.time.native_wall_clock_ms.value, None);
    assert_eq!(l.time.native_wall_clock_ms.basis, Basis::BoundaryConflict);
    assert_eq!(l.time.native_ttft_ms.value, Some(5));
    assert_eq!(l.time.derived_wall_clock_ms.basis, Basis::ResourceLimit);
    assert_eq!(l.context.input.samples.value, None);
    assert!(l.quality.partial);
    assert!(l.quality.reason_codes.contains(&Basis::BoundaryConflict));
    assert!(l.quality.reason_codes.contains(&Basis::ResourceLimit));
    assert!(matches!(
        l.evidence.collections[0].kind,
        CollectionKind::NativeBoundaryIndex
    ));
}
#[test]
fn cache_hits_refresh_freshness_and_remain_snapshot_owned() {
    let snapshot = make_snapshot(complete_events());
    let r = request(PrivacyProfile::Local);
    let first = local(
        query_on_snapshot(
            &snapshot,
            &r,
            QueryFreshness {
                status: "cached".into(),
                checked_at: Some("old".into()),
                ..Default::default()
            },
            &AtomicBool::new(false),
        )
        .unwrap(),
    );
    let second = local(
        query_on_snapshot(
            &snapshot,
            &r,
            QueryFreshness {
                status: "fresh".into(),
                checked_at: Some("new".into()),
                ..Default::default()
            },
            &AtomicBool::new(false),
        )
        .unwrap(),
    );
    assert!(!first.quality.partial);
    assert_eq!(second.freshness.checked_at.as_deref(), Some("new"));
    let key = serde_json::to_string(&(METHOD_VERSION, &r)).unwrap();
    assert!(snapshot.timing_cache.lock().unwrap().get(&key).is_some());
    assert!(super::super::cache::Cache::default().get(&key).is_none());
}
#[test]
fn canonical_input_type7_and_masks_reach_production_query() {
    let mut collected = data(complete_events());
    collected.measurements = [100u64, 500u64].into_iter().enumerate().map(|(i, input)| Arc::new(serde_json::from_value(serde_json::json!({"id":format!("m-{i}"),"agentKind":"codex","sourceInstanceId":"source-private","threadId":"thread-private","turnId":"turn-private","grain":"response","timePrecision":"unknown","model":{},"tokens":{"rawInput":input},"requestScoped":true,"sequence":i,"evidence":[]})).unwrap())).collect();
    let root = tempfile::tempdir().unwrap();
    let snapshot = usage_store::memory(
        collected,
        "live:private".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap();
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.context.input.samples.value, Some(2));
    assert_eq!(l.context.input.median.value, Some(300.0));
    assert_eq!(l.context.input.p90.value, Some(460.0));
    assert_eq!(l.context.ratio.samples.value, Some(0));
    assert_eq!(l.context.ratio.p90.value, None);
    assert_eq!(l.time.intersection_masks_ms[0].value, Some(100));
    assert_eq!(l.time.unclassified_ms.value, Some(100));
    assert_eq!(l.context.quantile_method, "type_7");
}

#[test]
fn numeric_schema_bounds_integer_values_and_preserves_finite_large_ratios() {
    let count_schema = serde_json::to_value(
        schemars::generate::SchemaSettings::draft07()
            .into_generator()
            .into_root_schema_for::<Count>(),
    )
    .unwrap();
    assert_eq!(
        count_schema["properties"]["value"]["maximum"],
        MAX_SAFE_INTEGER
    );
    assert_eq!(count_schema["properties"]["value"]["minimum"], 0);
    let signed_schema = serde_json::to_value(
        schemars::generate::SchemaSettings::draft07()
            .into_generator()
            .into_root_schema_for::<Signed>(),
    )
    .unwrap();
    assert_eq!(
        signed_schema["properties"]["value"]["minimum"],
        -(MAX_SAFE_INTEGER as i64)
    );
    assert_eq!(
        m::count(Some(u128::MAX), Basis::NativeRecord, &[]).basis,
        Basis::NumericRange
    );
    assert_eq!(
        m::signed(Some(i128::MIN), Basis::ExplicitBoundary, &[]).basis,
        Basis::NumericRange
    );
    assert_eq!(
        m::number(Some(f64::INFINITY), Basis::Type7, &[]).value,
        None
    );
    assert_eq!(
        m::ratio(Some(u64::MAX as f64), Basis::HistoricalWindow, &[]).value,
        Some(u64::MAX as f64)
    );
    assert_eq!(safe_timestamp(Some(i64::MAX)), (None, true));
    assert_eq!(safe_timestamp(Some(0)), (Some(0), false));
    // The currently accepted chrono/RFC3339 source domain is itself below the
    // safe range; the projection guard remains explicit for future widening.
    assert!(
        chrono::DateTime::<chrono::Utc>::MAX_UTC
            .timestamp_millis()
            .unsigned_abs()
            < MAX_SAFE_INTEGER
    );
    assert!(
        chrono::DateTime::<chrono::Utc>::MIN_UTC
            .timestamp_millis()
            .unsigned_abs()
            < MAX_SAFE_INTEGER
    );
}
#[test]
fn fixed_share_freshness_preserves_fixed_and_syncing_enum_states() {
    let snapshot = make_snapshot(complete_events());
    for state in ["fixed", "syncing"] {
        let Response::Share(response) = query_on_snapshot(
            &snapshot,
            &request(PrivacyProfile::ShareV1),
            QueryFreshness {
                status: state.into(),
                ..Default::default()
            },
            &AtomicBool::new(false),
        )
        .unwrap() else {
            panic!()
        };
        assert_eq!(response.freshness.status, state);
    }
}
#[test]
fn cache_enforces_entry_count_total_bytes_and_oversized_results() {
    let snapshot = make_snapshot(complete_events());
    let result = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let mut cache = super::super::cache::Cache::default();
    for i in 0..17 {
        assert!(cache.insert(format!("key-{i}"), result.clone()));
    }
    assert!(cache.get("key-0").is_none());
    assert!(cache.get("key-16").is_some());
    let mut large = result.clone();
    large.privacy.omitted_fields = vec!["x".repeat(170_000)];
    let mut bytes = super::super::cache::Cache::default();
    for i in 0..16 {
        assert!(bytes.insert(format!("key-{i}"), large.clone()));
    }
    assert!(bytes.get("key-0").is_none());
    assert!(bytes.get("key-15").is_some());
    assert!(!bytes.insert("oversized".into(), {
        let mut value = result.clone();
        value.privacy.omitted_fields = vec!["x".repeat(MAX_SUMMARY_BYTES)];
        value
    }));
    let mut partial = result;
    partial.quality.partial = true;
    assert!(!bytes.insert("partial".into(), partial));
}
#[test]
fn identity_time_and_content_conflicts_keep_specific_reasons() {
    let mut events = complete_events();
    events.push(boundary(
        3,
        Some(1_200),
        Phase::Completed,
        Some(121),
        Some(0),
    ));
    let snapshot = make_snapshot(events);
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.time.native_wall_clock_ms.basis, Basis::BoundaryConflict);
    assert_eq!(l.time.derived_wall_clock_ms.basis, Basis::BoundaryConflict);
    assert_eq!(l.time.native_ttft_ms.value, Some(0));
    let mut events = complete_events();
    events[1] = event(
        2,
        Some(1_050),
        Payload::Message {
            origin: MessageOrigin::AssistantVisible,
            presence: ContentPresence::NonEmpty,
            native_id: Some("known".into()),
            record_kind: MessageRecordKind::ResponseSnapshot,
            record_phase: Phase::Completed,
            content_phase: ContentPhase::Unknown,
        },
    );
    events[2] = boundary(3, Some(1_100), Phase::Completed, Some(120), Some(0));
    events.insert(
        1,
        event(
            1,
            None,
            Payload::Message {
                origin: MessageOrigin::AssistantVisible,
                presence: ContentPresence::NonEmpty,
                native_id: None,
                record_kind: MessageRecordKind::ResponseSnapshot,
                record_phase: Phase::Completed,
                content_phase: ContentPhase::Unknown,
            },
        ),
    );
    let snapshot = make_snapshot(events);
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(
        l.time.first_content_record_delay_ms.basis,
        Basis::MissingTime
    );
}
#[test]
fn excessive_context_detail_preserves_full_distribution_and_explains_omission() {
    let mut collected = data(complete_events());
    collected.measurements = (0..33).map(|i| Arc::new(serde_json::from_value(serde_json::json!({"id":format!("m-{i}"),"agentKind":"codex","sourceInstanceId":"source-private","threadId":"thread-private","turnId":"turn-private","grain":"response","timePrecision":"unknown","model":{},"tokens":{"rawInput":i},"requestScoped":true,"sequence":i,"evidence":[]})).unwrap())).collect();
    let root = tempfile::tempdir().unwrap();
    let snapshot = usage_store::memory(
        collected,
        "live:private".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap();
    let l = local(query(&snapshot, &request(PrivacyProfile::Local)));
    assert_eq!(l.context.input.samples.value, Some(33));
    assert_eq!(l.context.input.p90.value, Some(28.8));
    assert_eq!(l.context.segment_count.value, Some(33));
    assert!(l.context.segments.is_empty());
    assert_eq!(l.context.detail.reason, Basis::ResourceLimit);
    assert!(l.quality.partial);
    assert!(fits(&l).unwrap());
}

#[test]
fn combined_response_schema_keeps_unsigned_signed_and_fractional_metrics_distinct() {
    let schema = crate::dispatch("schema_timing_local_response", &serde_json::json!({})).unwrap();
    let definitions = schema["definitions"].as_object().unwrap();
    let count = definitions
        .iter()
        .find(|(name, _)| name.starts_with("TimingMetric_") && name.contains("uint64"))
        .unwrap()
        .1;
    let signed = definitions
        .iter()
        .find(|(name, _)| {
            name.starts_with("TimingMetric_") && name.contains("int64") && !name.contains("uint64")
        })
        .unwrap()
        .1;
    let number = definitions
        .iter()
        .find(|(name, _)| name.starts_with("TimingMetric_") && name.contains("double"))
        .unwrap()
        .1;
    assert_eq!(
        count["properties"]["value"]["type"],
        serde_json::json!(["integer", "null"])
    );
    assert_eq!(count["properties"]["value"]["minimum"], 0);
    assert_eq!(
        signed["properties"]["value"]["minimum"],
        -(MAX_SAFE_INTEGER as i64)
    );
    assert_eq!(
        number["properties"]["value"]["type"],
        serde_json::json!(["number", "null"])
    );
    assert!(number["properties"]["value"].get("maximum").is_none());
    let snapshot = make_snapshot(complete_events());
    let mut response = local(query(&snapshot, &request(PrivacyProfile::Local)));
    response.time.coverage_ratio = m::ratio(Some(0.5), Basis::IntervalMask, &[]);
    response.time.boundary_discrepancy_ms = m::signed(Some(-5), Basis::ExplicitBoundary, &[]);
    response.work.message_record_candidates = m::observed(3, &[]);
    let json = serde_json::to_value(response).unwrap();
    assert_eq!(json["time"]["coverageRatio"]["value"], 0.5);
    assert_eq!(json["time"]["boundaryDiscrepancyMs"]["value"], -5);
    assert_eq!(json["work"]["messageRecordCandidates"]["value"], 3);
}

#[test]
fn cancellation_cannot_publish_a_cache_entry() {
    let snapshot = make_snapshot(complete_events());
    let value = local(query(&snapshot, &request(PrivacyProfile::Local)));
    let mut cache = super::super::cache::Cache::default();
    let error = cache
        .insert_cancellable("cancelled".into(), value, &AtomicBool::new(true))
        .unwrap_err();
    assert_eq!(error_code(error), "CANCELLED");
    assert!(cache.get("cancelled").is_none());
}
