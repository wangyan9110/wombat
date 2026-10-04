use super::*;
use std::sync::atomic::AtomicBool;

fn request(value: Value) -> crate::timing_dto::Request {
    serde_json::from_value(value).unwrap()
}
fn state() -> Shared {
    Arc::new((Mutex::new(BTreeMap::new()), Condvar::new()))
}
fn code(error: anyhow::Error) -> &'static str {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
}
#[test]
fn timing_capabilities_and_invalid_requests_never_select_or_collect() {
    let state = state();
    let configs = Mutex::new(crate::config::Store::default());
    let (jobs, receiver) = mpsc::sync_channel(1);
    let cancelled = AtomicBool::new(false);
    let response = timing_query(
        request(json!({"action":"capabilities"})),
        &state,
        &jobs,
        &configs,
        &cancelled,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap()["action"],
        "capabilities"
    );
    for input in [
        json!({"action":"summary","threadId":"","turnId":"turn"}),
        json!({"action":"summary","threadId":"thread","turnId":"turn","snapshotId":"live:scope:fixed","mode":"fresh"}),
        json!({"action":"evidence","threadId":"thread","turnId":"turn","snapshotId":"live:scope:fixed","limit":201}),
        json!({"action":"evidence","threadId":"thread","turnId":"turn","snapshotId":"live:scope:fixed","privacyProfile":"share-v1"}),
    ] {
        assert_eq!(
            code(timing_query(request(input), &state, &jobs, &configs, &cancelled).unwrap_err()),
            "INVALID_ARGUMENT"
        );
    }
    assert!(state.0.lock().unwrap().is_empty());
    assert!(!configs.lock().unwrap().has_views());
    assert!(receiver.try_recv().is_err());
}
#[test]
fn timing_fixed_summary_and_evidence_use_same_retained_revision_without_sync() {
    let root = tempfile::tempdir().unwrap();
    let facts = Collected {
        threads: vec![Thread {
            id: "thread".into(), agent_kind:"codex".into(), source_instance_id:"source".into(), upstream_id:"native".into(),
            title:None,project:None,started_at:None,last_activity_at:None,
        }],
        turns:vec![serde_json::from_value(json!({"id":"turn","threadId":"thread","upstreamId":"turn","ordinal":1,"status":"completed"})).unwrap()],
        ..Default::default()
    };
    let snapshot = Arc::new(
        crate::usage_store::memory(
            facts,
            "live:scope:fixed".into(),
            crate::pricing_sync::current_at(root.path()).unwrap(),
            None,
        )
        .unwrap(),
    );
    let mut entry = Entry::new(vec![]);
    entry.checked = Some("2026-10-05T00:00:00Z".into());
    entry.views.push_back((Instant::now(), snapshot));
    entry.views.push_back((
        Instant::now(),
        Arc::new(
            crate::usage_store::memory(
                Default::default(),
                "live:scope:latest".into(),
                crate::pricing_sync::current_at(root.path()).unwrap(),
                None,
            )
            .unwrap(),
        ),
    ));
    let state = state();
    state.0.lock().unwrap().insert("scope".into(), entry);
    let configs = Mutex::new(crate::config::Store::default());
    let (jobs, receiver) = mpsc::sync_channel(1);
    let cancelled = AtomicBool::new(false);
    for action in ["summary", "evidence"] {
        let response = timing_query(request(json!({"action":action,"threadId":"thread","turnId":"turn","snapshotId":"live:scope:fixed"})),&state,&jobs,&configs,&cancelled).unwrap();
        let value = serde_json::to_value(response).unwrap();
        let identity = if action == "summary" {
            &value["readView"]["snapshotId"]
        } else {
            &value["snapshotId"]
        };
        assert_eq!(identity, "live:scope:fixed");
        assert_eq!(value["scope"]["threadId"], "thread");
        assert_eq!(value["scope"]["turnId"], "turn");
        if action == "summary" {
            assert_eq!(value["freshness"]["status"], "fixed");
            assert!(value["freshness"]["revision"].is_null());
        }
    }
    assert!(receiver.try_recv().is_err());
    assert!(!configs.lock().unwrap().has_views());
    assert_eq!(state.0.lock().unwrap()["scope"].requested, 0);
    cancelled.store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(code(timing_query(request(json!({"action":"summary","threadId":"thread","turnId":"turn","snapshotId":"live:scope:fixed"})),&state,&jobs,&configs,&cancelled).unwrap_err()),"CANCELLED");
}
