use super::*;
use crate::optimize::capabilities;
use std::fs;
#[test]
fn observed_problems_support_direct_manual_rechecks_and_recurrence() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reviews.sqlite3");
    let mut v = view();
    let first = query(&path, &v, Request::default());
    assert_eq!(
        first.history, 0,
        "observations are distinct from handling history"
    );
    let target = first.suggestions[0].id.clone();
    v.items[0].skill_metadata = Some(SkillMetadata {
        status: "parsed".into(),
        description_characters: Some(100),
        issues: vec![],
        diagnostics: vec![],
    });
    v.items[0].content_hash = "manually-fixed".into();
    let fixed = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            suggestion_id: Some(target),
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(fixed.pending, 0);
    assert_eq!(fixed.history, 1);
    assert_eq!(fixed.suggestions[0].status, "verified");
    assert_eq!(
        fixed.suggestions[0]
            .review_baseline
            .as_ref()
            .unwrap()
            .content_hash,
        "original"
    );
    let again = query(&path, &view(), Request::default());
    assert_eq!(
        again.pending, 1,
        "newly observed recurrence is not hidden by an earlier pass"
    );
    assert_eq!(again.suggestions[0].status, "pending");
    assert_eq!(
        again.history, 1,
        "re-observation does not rewrite handling history"
    );
}
#[test]
fn rechecking_kept_items_updates_facts_without_revoking_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reviews.sqlite3");
    let mut v = view();
    let id = query(&path, &v, Request::default()).suggestions[0]
        .id
        .clone();
    query(
        &path,
        &v,
        Request {
            action: Action::Keep,
            suggestion_id: Some(id.clone()),
            decision_reason: Some(DecisionReason::Necessary),
            ..Default::default()
        },
    );
    let kept = query(
        &path,
        &v,
        Request {
            group: Group::History,
            ..Default::default()
        },
    );
    let decision_time = kept.suggestions[0]
        .decision
        .as_ref()
        .unwrap()
        .recorded_at
        .clone();
    let checked = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(checked.pending, 0);
    assert_eq!(checked.suggestions[0].status, "stillNeedsReview");
    assert_eq!(
        checked.suggestions[0]
            .decision
            .as_ref()
            .unwrap()
            .recorded_at,
        decision_time
    );
    let revision = checked.decision_revision;
    let repeated = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(
        repeated.decision_revision, revision,
        "unchanged evidence is not a new event"
    );
    v.checked = "2026-10-02T00:00:00Z".into();
    v.items[0].current = false;
    let unavailable = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(unavailable.pending, 0);
    assert_eq!(unavailable.suggestions[0].status, "recheckUnavailable");
    assert_eq!(
        unavailable.suggestions[0]
            .decision
            .as_ref()
            .unwrap()
            .recorded_at,
        decision_time
    );
}

#[test]
fn inapplicability_requires_a_reason_and_redisplay_only_changes_the_decision() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reviews.sqlite3");
    let v = view();
    let first = query(&path, &v, Request::default());
    let id = first.suggestions[0].id.clone();
    for reason in [None, Some(DecisionReason::Necessary)] {
        assert!(
            execute_at(
                Request {
                    action: Action::NotApplicable,
                    suggestion_id: Some(id.clone()),
                    decision_reason: reason,
                    ..Default::default()
                },
                "view".into(),
                &v,
                &path
            )
            .is_err()
        );
    }
    query(
        &path,
        &v,
        Request {
            action: Action::NotApplicable,
            suggestion_id: Some(id.clone()),
            decision_reason: Some(DecisionReason::IncorrectEvidence),
            ..Default::default()
        },
    );
    let visible = query(
        &path,
        &v,
        Request {
            action: Action::Redisplay,
            suggestion_id: Some(id),
            ..Default::default()
        },
    );
    assert_eq!(visible.pending, 1);
    assert!(visible.suggestions[0].decision.is_none());
    assert_eq!(
        visible.suggestions[0].item.content_hash,
        first.suggestions[0].item.content_hash
    );
    assert_eq!(
        serde_json::to_value(&visible.suggestions[0].checks).unwrap(),
        serde_json::to_value(&first.suggestions[0].checks).unwrap()
    );
    let history = query(
        &path,
        &v,
        Request {
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(history.history, 2);
    assert!(
        history.suggestions[1].decision.is_some(),
        "the original decision remains in history"
    );
}
#[test]
fn object_findings_decision_scope_and_versions_are_independent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("user/reviews.sqlite3");
    let mut v = view();
    let first = query(
        &path,
        &v,
        Request {
            project: Some("/project".into()),
            ..Default::default()
        },
    );
    assert_eq!(first.pending, 1);
    assert_eq!(first.suggestions[0].findings.len(), 2);
    assert_eq!(first.suggestions[0].category, Category::Repair);
    let ignored = query(
        &path,
        &v,
        Request {
            action: Action::Keep,
            decision_reason: Some(DecisionReason::Necessary),
            suggestion_id: Some(first.suggestions[0].id.clone()),
            project: Some("/project".into()),
            decision_revision: Some(first.decision_revision.clone()),
            ..Default::default()
        },
    );
    assert_eq!(ignored.pending, 0);
    assert_eq!(ignored.history, 1);
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                project: Some("/project".into()),
                rule_overrides: Some(RuleOverrides {
                    agents_bytes: Some(16384),
                    description_characters: Some(500)
                }),
                ..Default::default()
            }
        )
        .pending,
        0,
        "explicit defaults do not invalidate an unchanged ignore decision"
    );
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                action: Action::Keep,
                decision_reason: Some(DecisionReason::Necessary),
                suggestion_id: Some(first.suggestions[0].id.clone()),
                project: Some("/project".into()),
                decision_revision: Some(ignored.decision_revision.clone()),
                ..Default::default()
            }
        )
        .history,
        1,
        "an acknowledged retry does not duplicate the user record"
    );
    assert!(
        execute_at(
            Request {
                decision_revision: Some(first.decision_revision),
                ..Default::default()
            },
            "id".into(),
            &v,
            &path
        )
        .is_err()
    );
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                project: Some("/other".into()),
                ..Default::default()
            }
        )
        .pending,
        1
    );
    assert_eq!(query(&path, &v, Request::default()).pending, 1);
    let unauthorized = execute_at(
        Request {
            project: Some("/unauthorized".into()),
            ..Default::default()
        },
        "id".into(),
        &v,
        &path,
    )
    .unwrap_err();
    assert_eq!(
        unauthorized
            .downcast_ref::<crate::dto::OperationError>()
            .unwrap()
            .code,
        "PROJECT_NOT_AUTHORIZED"
    );
    v.items[0].content_hash = "changed".into();
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                project: Some("/project".into()),
                ..Default::default()
            }
        )
        .pending,
        1,
        "new content is not ignored"
    );
    v.items[0].content_hash = "original".into();
    v.items[0]
        .skill_metadata
        .as_mut()
        .unwrap()
        .issues
        .push("independentProblem".into());
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                project: Some("/project".into()),
                ..Default::default()
            }
        )
        .pending,
        1,
        "independent findings are not ignored"
    );
}

#[test]
fn manual_review_requires_observable_recheck_and_retains_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reviews.sqlite3");
    let mut v = view();
    let first = query(&path, &v, Request::default());
    let target = first.suggestions[0].id.clone();
    query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            suggestion_id: Some(target),
            ..Default::default()
        },
    );
    let unchanged = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(unchanged.suggestions[0].status, "stillNeedsReview");
    let baseline = unchanged.suggestions[0].review_baseline.as_ref().unwrap();
    assert_eq!(
        baseline.content_hash,
        first.suggestions[0].item.content_hash
    );
    assert_eq!(baseline.bytes, first.suggestions[0].item.bytes);
    // Removed files can retain complete historical metadata in the inventory.
    v.items[0].current = false;
    let removed = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(removed.suggestions[0].status, "recheckUnavailable");
    assert_eq!(
        removed.suggestions[0]
            .review_baseline
            .as_ref()
            .unwrap()
            .content_hash,
        first.suggestions[0].item.content_hash
    );
    v.items[0].current = true;
    v.items[0].measurement_status = "unavailable".into();
    let unavailable = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(unavailable.suggestions[0].status, "recheckUnavailable");
    v.items[0].measurement_status = "complete".into();
    v.items[0].bytes = Some(16384);
    v.items[0].skill_metadata = Some(SkillMetadata {
        status: "parsed".into(),
        description_characters: Some(500),
        issues: vec![],
        diagnostics: vec![],
    });
    v.items[0].body_token_estimate = Some(body_estimate(4999));
    v.items[0].body_estimate_status = "estimated".into();
    v.items[0].content_hash = "fixed".into();
    let fixed = query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            group: Group::History,
            ..Default::default()
        },
    );
    assert_eq!(fixed.pending, 0);
    assert_eq!(fixed.suggestions[0].status, "verified");
    assert_eq!(fixed.history, 4);
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                group: Group::History,
                limit: Some(1),
                ..Default::default()
            }
        )
        .page
        .next_offset,
        Some(1)
    );
    let fresh = view();
    assert_eq!(
        query(
            &path,
            &fresh,
            Request {
                group: Group::History,
                ..Default::default()
            }
        )
        .history,
        4,
        "a rebuilt inventory does not delete user records"
    );
    assert!(
        fs::read(&path)
            .unwrap()
            .windows(10)
            .all(|w| w != b"secretbody")
    );
}

#[test]
fn incomplete_yaml_checks_cannot_pass_a_manual_recheck() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut v = view();
    let id = query(&path, &v, Request::default()).suggestions[0]
        .id
        .clone();
    query(
        &path,
        &v,
        Request {
            action: Action::Recheck,
            suggestion_id: Some(id),
            ..Default::default()
        },
    );
    v.items[0].bytes = Some(20);
    for status in ["resourceLimited", "unsupported"] {
        v.items[0].skill_metadata = Some(SkillMetadata {
            status: status.into(),
            description_characters: None,
            issues: vec![],
            diagnostics: vec![],
        });
        let result = query(
            &path,
            &v,
            Request {
                action: Action::Recheck,
                group: Group::History,
                ..Default::default()
            },
        );
        assert_eq!(result.suggestions[0].status, "recheckUnavailable");
        assert_eq!(
            result.pending, 1,
            "unavailable evidence retains the original recommendation"
        );
    }
}

#[test]
fn redisplay_rejects_repeated_stale_actions_and_limits_are_strict() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let v = view();
    let id = query(&path, &v, Request::default()).suggestions[0]
        .id
        .clone();
    query(
        &path,
        &v,
        Request {
            action: Action::Keep,
            decision_reason: Some(DecisionReason::Necessary),
            suggestion_id: Some(id.clone()),
            ..Default::default()
        },
    );
    assert_eq!(
        query(
            &path,
            &v,
            Request {
                action: Action::Redisplay,
                suggestion_id: Some(id.clone()),
                ..Default::default()
            }
        )
        .pending,
        1
    );
    assert!(
        execute_at(
            Request {
                action: Action::Redisplay,
                suggestion_id: Some(id),
                ..Default::default()
            },
            "id".into(),
            &v,
            &path
        )
        .is_err()
    );
    assert!(
        execute_at(
            Request {
                limit: Some(201),
                ..Default::default()
            },
            "id".into(),
            &v,
            &path
        )
        .is_err()
    );
    assert!(capabilities().capabilities.decisions);
    assert!(capabilities().capabilities.manual_edit_review);
}
