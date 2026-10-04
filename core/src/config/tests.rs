use super::*;
fn view() -> View {
    View {
        hook_registry: HookRegistry::default(),
        snapshot: None,
        items: vec![],
        issues: vec![],
        projects: vec![],
        roots: vec![],
        project_roots: vec![],
        revision: "one".into(),
        checked: "now".into(),
        history_status: "unavailable".into(),
        analysis: Default::default(),
    }
}
#[test]
fn views_expire_explicitly_and_store_is_bounded() {
    let mut store = Store::default();
    let (first, _) = store.insert(view());
    for _ in 0..8 {
        store.insert(view());
    }
    assert_eq!(store.views.len(), 8);
    assert!(store.get(&first).is_err());
    let (last, _) = store.insert(view());
    store.views.back_mut().unwrap().1 = Instant::now() - Duration::from_secs(601);
    assert!(store.get(&last).is_err());
    for (_, at, _) in &mut store.views {
        *at = Instant::now() - Duration::from_secs(601);
    }
    assert!(!store.has_views());
}
#[test]
fn local_dates_use_exclusive_end_and_preserve_unknowns() {
    let (scope, tz) = normalize(&Scope {
        since: Some("2026-09-29".into()),
        until: Some("2026-09-30".into()),
        timezone: Some("Asia/Shanghai".into()),
        ..Default::default()
    })
    .unwrap();
    assert!(in_time(Some("2026-09-28T16:00:00Z"), &scope, tz));
    assert!(!in_time(Some("2026-09-29T16:00:00Z"), &scope, tz));
    assert!(!in_time(None, &scope, tz));
    let result = execute(Request::default(), "view".into(), &view()).unwrap();
    assert!(result.summary.usage.is_none());
    assert!(!result.coverage.absence_observable);
    assert_eq!(result.coverage.status, "partial");
}
