use super::*;
fn metric(value: Option<u64>, basis: t::Basis) -> t::Count {
    t::Metric {
        value,
        status: if value.is_some() {
            t::MetricStatus::Derived
        } else {
            t::MetricStatus::Unavailable
        },
        basis,
        evidence_refs: vec!["collection:turn".into()],
    }
}
#[test]
fn positive_partial_signals_remain_hits_while_gaps_never_prove_a_miss() {
    let rule = ActivityRule::InspectCallsAfterFailure;
    assert_eq!(
        check(
            rule,
            "same_operation_after_failure_v1",
            &metric(Some(2), t::Basis::RepeatAfterFailure),
            true
        )
        .outcome,
        RuleOutcome::Hit
    );
    assert_eq!(
        check(
            rule,
            "same_operation_after_failure_v1",
            &metric(Some(0), t::Basis::RepeatAfterFailure),
            true
        )
        .outcome,
        RuleOutcome::Insufficient
    );
    assert_eq!(
        check(
            rule,
            "same_operation_after_failure_v1",
            &metric(Some(0), t::Basis::RepeatAfterFailure),
            false
        )
        .outcome,
        RuleOutcome::Miss
    );
    assert_eq!(
        check(
            rule,
            "same_operation_after_failure_v1",
            &metric(None, t::Basis::ResourceLimit),
            true
        )
        .outcome,
        RuleOutcome::Insufficient
    );
    assert_eq!(
        check(
            rule,
            "same_operation_after_failure_v1",
            &metric(Some(1), t::Basis::SameRequestObservation),
            false
        )
        .outcome,
        RuleOutcome::Unsupported
    );
}
#[test]
fn count_checks_ignore_optional_duration_gaps_and_request_counts_ignore_time_and_outcomes() {
    use t::RepeatCoverageReason as Gap;
    let optional = [
        Gap::MissingDurations,
        Gap::MissingRecoverySpans,
        Gap::MissingIntervals,
        Gap::MissingWindow,
        Gap::DurationConflicts,
        Gap::ContextBoundaries,
    ];
    for rule in [
        ActivityRule::InspectCallsAfterFailure,
        ActivityRule::InspectRepeatedReads,
        ActivityRule::InspectRepeatedRequests,
    ] {
        assert!(!count_gap(&optional, "complete", rule));
        assert!(count_gap(&[Gap::MissingMatching], "complete", rule));
        assert!(count_gap(&[], "partial", rule));
    }
    assert!(!count_gap(
        &[Gap::MissingStart, Gap::IndeterminateOutcomes],
        "complete",
        ActivityRule::InspectRepeatedRequests
    ));
    assert!(count_gap(
        &[Gap::MissingStart],
        "complete",
        ActivityRule::InspectCallsAfterFailure
    ));
}
#[test]
fn activity_selection_requires_fixed_scope_and_cannot_enter_configuration_or_handling() {
    let valid = Request {
        action: Action::Activity,
        activity: Some(ActivitySelection {
            snapshot_id: "live:fixed".into(),
            thread_id: "task".into(),
            turn_id: "turn".into(),
        }),
        ..Default::default()
    };
    validate(&valid).unwrap();
    let t::Request::Summary {
        snapshot_id, mode, ..
    } = timing_request(&valid).unwrap()
    else {
        panic!()
    };
    assert_eq!(snapshot_id.as_deref(), Some("live:fixed"));
    assert_eq!(mode, t::Mode::Cached);
    for request in [
        Request {
            read_view: Some("config:other".into()),
            ..valid.clone()
        },
        Request {
            project_roots: Some(vec![]),
            ..valid.clone()
        },
        Request {
            rule_overrides: Some(Default::default()),
            ..valid.clone()
        },
        Request {
            group: Group::History,
            ..valid.clone()
        },
        Request {
            action: Action::Keep,
            ..valid.clone()
        },
        Request {
            activity: None,
            ..valid.clone()
        },
    ] {
        assert!(validate(&request).is_err());
    }
    let mut empty = valid;
    empty.activity.as_mut().unwrap().snapshot_id.clear();
    assert!(validate(&empty).is_err());
}
