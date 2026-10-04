use super::*;
use serde_json::json;
fn request() -> Request {
    let identity = json!({"requiresOpenaiAuth":true,"account":{"type":"chatgpt","email":"synthetic@example.invalid","planType":"pro"},"workspaceRouting":{"chatgptAccountId":"synthetic-account"}});
    let account=crate::account::normalize(serde_json::from_value(json!({"action":"read","nativeVersion":"0.160.0","checkedAt":"2026-10-04T00:00:00Z","before":identity,"after":identity,"rates":{"accountId":"synthetic-account","ordinaryUsageAllowed":false,"rateLimitUpsell":{"banner_type":"selected_model_limit","blocked_model_slug":"synthetic-model","reset_at":1791075600},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":100,"windowDurationMins":17,"resetsAt":1791075600},"rateLimitReachedType":"rate_limit_reached"}}},"activity":null,"accountError":null,"ratesError":null,"activityError":null})).unwrap()).unwrap();
    Request {
        account,
        model: Some("synthetic-model".into()),
        provider: Some("openai".into()),
        now: "2026-10-04T00:00:01Z".into(),
    }
}
#[test]
fn only_an_explicit_current_request_model_restriction_blocks() {
    let gate = evaluate(request()).unwrap();
    assert_eq!(gate.status, AllowanceStatus::Blocked);
    assert!(
        gate.window_id.is_none(),
        "the notice does not identify a quota bucket"
    );
    assert_eq!(
        gate.valid_until.as_deref(),
        Some("2026-10-04T00:01:00+00:00")
    );
    let mut r = request();
    r.model = Some("other-model".into());
    assert_eq!(
        evaluate(r).unwrap().status,
        AllowanceStatus::Low,
        "ordinary allowance only warns"
    );
    let mut r = request();
    r.provider = Some("other-provider".into());
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
    let mut r = request();
    r.model = None;
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
}
#[test]
fn quota_alias_metadata_and_spend_flags_cannot_assign_a_request_model() {
    let mut r = request();
    r.account.model_restriction = None;
    r.account.buckets[0].id = "base_model_inference".into();
    r.account.buckets[0].name = Some("gpt-reserve".into());
    r.account.buckets[0].model = r.model.clone();
    r.account.buckets[0].spend_control_reached = Some(true);
    r.account.windows[0].bucket_id = "base_model_inference".into();
    r.account.windows[0].model = r.model.clone();
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
    let mut r = request();
    r.account.model_restriction = None;
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Low);
}
#[test]
fn percentages_and_time_never_infer_execution_denial_or_recovery() {
    let mut r = request();
    r.account.model_restriction = None;
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Low);
    for now in ["2026-10-04T00:01:00Z", "2026-10-03T23:59:59Z"] {
        let mut r = request();
        r.now = now.into();
        assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
    }
    let mut r = request();
    r.account.model_restriction.as_mut().unwrap().resets_at = Some("2026-10-04T00:00:00Z".into());
    r.account.windows[0].resets_at = Some("2026-10-04T00:00:00Z".into());
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
    let mut r = request();
    r.account.allowance.status = "stale".into();
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
}
#[test]
fn warning_threshold_and_ordinary_permission_remain_independent() {
    for (used, status) in [
        (89.0, AllowanceStatus::Available),
        (90.0, AllowanceStatus::Low),
        (99.0, AllowanceStatus::Low),
    ] {
        let mut r = request();
        r.account.model_restriction = None;
        r.account.ordinary_usage_allowed = Some(true);
        r.account.windows[0].used_percent = used;
        r.account.buckets[0].rate_limit_reached_type = None;
        assert_eq!(evaluate(r).unwrap().status, status);
    }
    let mut r = request();
    r.account.model_restriction = None;
    r.account.windows[0].used_percent = 0.0;
    r.account.buckets[0].rate_limit_reached_type = None;
    r.account.ordinary_usage_allowed = None;
    assert_eq!(evaluate(r).unwrap().status, AllowanceStatus::Unknown);
    let mut r = request();
    r.account.model_restriction.as_mut().unwrap().resets_at = Some("2026-10-04T00:00:20Z".into());
    assert_eq!(
        evaluate(r).unwrap().valid_until.as_deref(),
        Some("2026-10-04T00:00:20+00:00")
    );
}
