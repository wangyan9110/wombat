use super::*;
use std::sync::atomic::AtomicBool;

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
fn usage_business_validation_precedes_view_selection_and_sync() {
    let state = state();
    let (jobs, receiver) = mpsc::sync_channel(1);
    let configs = Mutex::new(crate::config::Store::default());
    for value in [
        json!({"query":{"action":"steps"}}),
        json!({"query":{"action":"usage"},"verify":true}),
        json!({"query":{"action":"refresh"},"mode":"cached"}),
        json!({"query":{"action":"usage","snapshotId":"live::revision"}}),
    ] {
        let request: Request = serde_json::from_value(value).unwrap();
        assert_eq!(
            code(query(request, &state, &jobs, &configs).unwrap_err()),
            "INVALID_ARGUMENT"
        );
        assert!(state.0.lock().unwrap().is_empty());
        assert!(receiver.try_recv().is_err());
    }
}

#[test]
fn expired_live_entry_resolves_only_exact_config_retained_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let snapshot = Arc::new(
        crate::usage_store::memory(
            Default::default(),
            "live:scope:retained".into(),
            crate::pricing_sync::current_at(root.path()).unwrap(),
            None,
        )
        .unwrap(),
    );
    let view = crate::config::View {
        snapshot: Some(Arc::clone(&snapshot)),
        items: vec![],
        issues: vec![],
        projects: vec![],
        roots: vec![],
        project_roots: vec![],
        revision: "config-revision".into(),
        checked: "2026-10-04T00:00:00Z".into(),
        history_status: "unknown".into(),
        analysis: Default::default(),
        hook_registry: Default::default(),
        config_collection: Default::default(),
        observation_versions: Default::default(),
    };
    let configs = Mutex::new(crate::config::Store::default());
    configs.lock().unwrap().insert(view);
    let state = state();
    let (jobs, receiver) = mpsc::sync_channel(1);
    let cancelled = AtomicBool::new(false);
    let selector = selection::ReadViewSelector::new(
        vec![],
        Some("live:scope:retained".into()),
        Mode::Cached,
        false,
        false,
    )
    .unwrap();
    let (actual, freshness) =
        select_with_retained(&selector, &state, &jobs, &configs, &cancelled).unwrap();
    assert!(Arc::ptr_eq(&actual, &snapshot));
    assert!(state.0.lock().unwrap().is_empty());
    assert_eq!(freshness.status, "fixed");
    assert_eq!(
        freshness.checked_at.as_deref(),
        Some("2026-10-04T00:00:00Z")
    );
    let absent = selection::ReadViewSelector::new(
        vec![],
        Some("live:scope:absent".into()),
        Mode::Auto,
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        code(
            select_with_retained(&absent, &state, &jobs, &configs, &cancelled)
                .err()
                .unwrap()
        ),
        "VIEW_EXPIRED"
    );
    assert!(receiver.try_recv().is_err());
    cancelled.store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(
        code(
            select_with_retained(&selector, &state, &jobs, &configs, &cancelled)
                .err()
                .unwrap()
        ),
        "CANCELLED"
    );
}
