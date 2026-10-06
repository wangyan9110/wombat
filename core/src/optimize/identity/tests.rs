//! Synthetic rule/store truths without source collection or the assembled service.
use super::*;
use crate::{
    config::View,
    config_dto::{Item, Kind},
    dto::OperationError,
    optimize::{
        detection,
        evaluation::{self, Baseline},
        reviews, store,
    },
};
use serde_json::json;
fn view() -> View {
    let item: Item = serde_json::from_value(json!({
        "id":"object","name":"name","kind":"rule","sourceInstanceId":"source","path":"/safe/AGENTS.md",
        "authorizedProjects":[],"sourceContexts":[],"configuredState":"discovered","contentHash":"v1",
        "observedAt":"2026-10-01T00:00:00Z","current":true,"stale":false,"bytes":20000,
        "bytesSource":"completeUtf8File","estimateStatus":"unknown","measurementStatus":"complete",
        "bodyEstimateStatus":"unknown","observation":"unknown",
        "counts":{"fileReads":0,"toolCalls":0,"resourceReads":0,"succeeded":0,"failed":0,"outcomeUnknown":0},
        "relatedTurns":0,"relatedTasks":0
    })).unwrap();
    View {
        items: vec![item],
        snapshot: None,
        issues: vec![],
        projects: vec![],
        roots: vec!["/safe".into()],
        project_roots: vec![],
        revision: "irrelevant".into(),
        checked: "2026-10-01T00:00:00Z".into(),
        history_status: "unavailable".into(),
        analysis: Default::default(),
        hook_registry: Default::default(),
        config_collection: Default::default(),
        observation_versions: Default::default(),
    }
}
fn file_check(v: &View, p: &RuleParameters) -> RuleAssessment {
    evaluation::evaluate(&Input::initial(v, &v.items[0], p, None))
        .into_iter()
        .find(|c| c.rule == "fileSize")
        .unwrap()
}
fn recheck(v: &View, old: &Suggestion, p: &RuleParameters) -> RuleAssessment {
    let baseline = old.review_baseline.as_ref().unwrap();
    evaluation::evaluate(&Input {
        baseline: Some(Baseline {
            findings: &old.findings,
            assessments: &baseline.assessments,
            scope: &baseline.scope,
        }),
        ..Input::initial(v, &v.items[0], p, None)
    })
    .into_iter()
    .find(|c| c.rule == "fileSize")
    .unwrap()
}
fn original(v: &View) -> Suggestion {
    detection::detect(v, &RuleParameters::default()).remove(0)
}
fn code(error: anyhow::Error) -> &'static str {
    error.downcast_ref::<OperationError>().unwrap().code
}
#[test]
fn problem_id_survives_content_threshold_and_cutoff_but_assessment_ids_do_not() {
    let mut v = view();
    let p = RuleParameters::default();
    let old = file_check(&v, &p);
    v.items[0].content_hash = "v2".into();
    v.items[0].bytes = Some(25000);
    v.checked = "2026-10-02T00:00:00Z".into();
    let mut p2 = p.clone();
    p2.overrides.agents_bytes = Some(17000);
    let new = file_check(&v, &p2);
    assert!(old.findings[0].identity.finding_id.is_some());
    assert_eq!(
        old.findings[0].identity.finding_id,
        new.findings[0].identity.finding_id
    );
    assert_ne!(old.assessment_id, new.assessment_id);
    assert_ne!(old.basis.dependency_revision, new.basis.dependency_revision);
}
#[test]
fn decision_binding_ignores_cutoff_and_global_revision_but_checks_material_dependencies() {
    let mut v = view();
    let old = original(&v);
    let decision = UserDecision {
        binding: binding(&old),
        kind: DecisionKind::Keep,
        reason: DecisionReason::Necessary,
        recorded_at: "fixed".into(),
    };
    v.checked = "2026-10-02T00:00:00Z".into();
    v.revision = "global-rebuilt".into();
    let same = original(&v);
    assert_ne!(old.checks[0].assessment_id, same.checks[0].assessment_id);
    assert!(decision_applies(&decision, &same));
    let mut changed = same.clone();
    changed
        .checks
        .iter_mut()
        .filter(|c| c.outcome == RuleOutcome::Hit)
        .for_each(|c| c.method_versions[0].version += 1);
    assert!(!decision_applies(&decision, &changed));
    changed = same;
    changed.item.content_hash = "changed".into();
    assert!(!decision_applies(&decision, &changed));
}
#[test]
fn miss_keeps_exact_zero_measurement_and_threshold_and_comparable_resolution() {
    let mut v = view();
    let old = original(&v);
    v.items[0].content_hash = "v2".into();
    v.items[0].bytes = Some(0);
    let check = recheck(&v, &old, &RuleParameters::default());
    assert_eq!(check.outcome, RuleOutcome::Miss);
    assert!(matches!(
        check.basis.measurement,
        RuleMeasurement::Numeric {
            observed: Some(0),
            threshold: 16384,
            inclusive: false,
            ..
        }
    ));
    assert_eq!(check.comparison.status, ComparisonStatus::Comparable);
    assert_eq!(reviews::status(std::slice::from_ref(&check), 1), "verified");
}
#[test]
fn parameter_rule_and_actual_method_upgrades_remain_current_misses_and_incomparable() {
    let mut v = view();
    let old = original(&v);
    v.items[0].bytes = Some(0);
    v.items[0].content_hash = "v2".into();
    for p in [
        RuleParameters {
            overrides: RuleOverrides {
                agents_bytes: Some(30000),
                ..Default::default()
            },
            ..Default::default()
        },
        RuleParameters {
            version: "new-semantics".into(),
            ..Default::default()
        },
    ] {
        let check = recheck(&v, &old, &p);
        assert_eq!(check.outcome, RuleOutcome::Miss);
        assert_eq!(check.comparison.status, ComparisonStatus::Incomparable);
        assert_eq!(reviews::status(&[check], 1), "recheckUnavailable");
    }
    let mut old_method = old.clone();
    old_method
        .review_baseline
        .as_mut()
        .unwrap()
        .assessments
        .iter_mut()
        .for_each(|c| c.method_versions[0].version = 2);
    let check = recheck(&v, &old_method, &RuleParameters::default());
    assert_eq!(check.comparison.status, ComparisonStatus::Incomparable);
    v.items[0].bytes_source = Some("other-measurement-v2".into());
    assert_eq!(
        recheck(&v, &old, &RuleParameters::default())
            .comparison
            .status,
        ComparisonStatus::Incomparable
    );
}
#[test]
fn original_scope_cutoff_and_assessments_survive_repeated_capture_and_current_updates() {
    let mut v = view();
    let mut old = original(&v);
    let baseline = serde_json::to_value(&old.review_baseline).unwrap();
    v.checked = "later".into();
    v.items[0].content_hash = "new".into();
    v.items[0].bytes = Some(0);
    old.checks = vec![recheck(&v, &old, &RuleParameters::default())];
    old.item = v.items[0].clone();
    capture(&mut old);
    assert_eq!(
        serde_json::to_value(&old.review_baseline).unwrap(),
        baseline
    );
    v.roots.push("/other".into());
    assert_eq!(
        recheck(&v, &old, &RuleParameters::default())
            .comparison
            .status,
        ComparisonStatus::Incomparable
    );
}
#[test]
fn absent_assessment_or_dependency_identity_never_matches_even_when_both_are_none() {
    let mut v = view();
    let mut old = original(&v);
    let baseline = old.review_baseline.as_mut().unwrap();
    baseline.assessments.iter_mut().for_each(|c| {
        c.assessment_id = None;
        c.identity_gap = Some("budget".into());
        c.basis.dependency_revision = None;
    });
    v.items[0].bytes = Some(0);
    v.roots = vec!["/safe".into(); 1025];
    let check = recheck(&v, &old, &RuleParameters::default());
    assert_eq!(check.outcome, RuleOutcome::Miss);
    assert!(check.assessment_id.is_none());
    assert!(check.identity_gap.is_some());
    assert_eq!(check.comparison.status, ComparisonStatus::Unknown);
    assert_eq!(reviews::status(&[check], 1), "recheckUnavailable");
}
#[test]
fn missing_current_and_partial_evidence_cannot_resolve() {
    let mut v = view();
    let old = original(&v);
    for status in ["missing", "unavailable"] {
        v.items[0].measurement_status = status.into();
        v.items[0].bytes = None;
        let check = recheck(&v, &old, &RuleParameters::default());
        assert_eq!(check.outcome, RuleOutcome::Insufficient);
        assert_eq!(check.comparison.status, ComparisonStatus::Unknown);
    }
    v.items[0].current = false;
    assert_eq!(
        recheck(&v, &old, &RuleParameters::default())
            .comparison
            .status,
        ComparisonStatus::Unknown
    );
}
#[test]
fn size_recheck_uses_its_measurement_method_without_requiring_file_content() {
    let mut v = view();
    v.items[0].measurement_status = "unavailable".into();
    v.items[0].configured_state = "unreadable".into();
    v.items[0].content_hash.clear();
    v.items[0].bytes_source = Some("filesystemMetadata".into());
    let old = original(&v);
    v.items[0].bytes = Some(0);
    let check = recheck(&v, &old, &RuleParameters::default());
    assert_eq!(check.outcome, RuleOutcome::Miss);
    assert_eq!(check.comparison.status, ComparisonStatus::Comparable);
    assert_eq!(reviews::status(&[check], 1), "verified");

    v.items[0].bytes_source = Some("completeUtf8File".into());
    v.items[0].measurement_status = "complete".into();
    v.items[0].content_hash = "new-content".into();
    let check = recheck(&v, &old, &RuleParameters::default());
    assert_eq!(check.outcome, RuleOutcome::Miss);
    assert_eq!(check.comparison.status, ComparisonStatus::Incomparable);
    assert_eq!(reviews::status(&[check], 1), "recheckUnavailable");

    v.items[0].bytes_source = Some("filesystemMetadata".into());
    v.items[0].measurement_status = "unavailable".into();
    v.items[0].bytes = None;
    let check = recheck(&v, &old, &RuleParameters::default());
    assert_eq!(check.outcome, RuleOutcome::Insufficient);
    assert_eq!(check.comparison.status, ComparisonStatus::Unknown);
}
#[test]
fn reference_and_block_aggregates_do_not_gain_identity_from_name_hash_or_line() {
    let v = view();
    let mut f = original(&v).findings.remove(0);
    for rule in ["localReference", "exactInstructionBlocks"] {
        f.rule = rule.into();
        let id = finding(
            &Input::initial(&v, &v.items[0], &RuleParameters::default(), None),
            &f,
        );
        assert!(id.finding_id.is_none());
        assert_eq!(id.gap.as_deref(), Some("problemLocationContextUnavailable"));
    }
}
#[test]
fn description_suppressed_miss_retains_observation_and_both_thresholds() {
    let mut v = view();
    v.items[0].kind = Kind::Skill;
    v.items[0].skill_metadata = Some(crate::config_dto::SkillMetadata {
        status: "parsed".into(),
        description_characters: Some(1600),
        issues: vec![],
        diagnostics: vec![],
    });
    let check = evaluation::evaluate(&Input::initial(
        &v,
        &v.items[0],
        &RuleParameters::default(),
        None,
    ))
    .into_iter()
    .find(|c| c.rule == "descriptionSize")
    .unwrap();
    assert_eq!(check.outcome, RuleOutcome::Miss);
    assert!(matches!(
        check.basis.measurement,
        RuleMeasurement::Numeric {
            observed: Some(1600),
            threshold: 500,
            standard_max: Some(1024),
            suppressed_by_standard: true,
            ..
        }
    ));
}
#[test]
fn unsupported_check_names_its_evidence_gap_and_never_has_a_wildcard_identity() {
    let mut v = view();
    v.items[0].kind = Kind::Mcp;
    for check in evaluation::evaluate(&Input::initial(
        &v,
        &v.items[0],
        &RuleParameters::default(),
        None,
    )) {
        assert_eq!(check.outcome, RuleOutcome::Unsupported);
        assert!(check.assessment_id.is_none());
        assert_eq!(check.identity_gap.as_deref(), Some("unsupportedEvidence"));
        assert!(matches!(
            check.basis.measurement,
            RuleMeasurement::Unsupported { .. }
        ));
    }
}
#[test]
fn required_record_headers_precede_future_shapes_and_preserve_user_rows() {
    for (path, version) in [
        ("$.reviewFormatVersion", 9),
        ("$.reviewBaseline.version", 9),
        ("$.checks[0].basis.version", 9),
        ("$.findings[0].identity.version", 9),
        ("$.decision.binding.version", 9),
    ] {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        store::initialize(&mut db).unwrap();
        let tx = db.transaction().unwrap();
        let mut s = original(&view());
        s.decision = Some(UserDecision {
            binding: binding(&s),
            kind: DecisionKind::Keep,
            reason: DecisionReason::Necessary,
            recorded_at: "fixed".into(),
        });
        store::append(&tx, &mut s, RecordKind::Decision).unwrap();
        // Mutate the normalized relevant part, including a shape the current reader cannot decode.
        let (column, local) = if path.starts_with("$.reviewBaseline") {
            ("baseline", "$.version")
        } else if path.starts_with("$.checks") {
            ("checks", "$[0].basis.version")
        } else if path.starts_with("$.decision") {
            ("event", "$.decision.binding.version")
        } else {
            ("basis", path)
        };
        if column == "event" {
            tx.execute("UPDATE review_events SET event=jsonb(json_set(event,?1,?2,'$.decision.binding.futureField',json('{}'))) WHERE seq=1", rusqlite::params![local,version]).unwrap();
        } else {
            tx.execute(&format!("UPDATE review_parts SET payload=jsonb(json_set(payload,?1,?2,'$.futureField',json('{{}}'))) WHERE id=(SELECT {column} FROM review_events WHERE seq=1)"), rusqlite::params![local,version]).unwrap();
        }
        assert_eq!(
            code(store::get(&tx, 1).unwrap_err()),
            "UNSUPPORTED_VERSION",
            "{path}"
        );
        assert_eq!(
            tx.query_row("SELECT COUNT(*) FROM review_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
#[test]
fn current_record_missing_binding_or_invalid_baseline_is_corrupt_without_repair() {
    for malformed in ["$.decision.binding", "$.reviewFormatVersion"] {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        store::initialize(&mut db).unwrap();
        let tx = db.transaction().unwrap();
        let mut s = original(&view());
        s.decision = Some(UserDecision {
            binding: binding(&s),
            kind: DecisionKind::Keep,
            reason: DecisionReason::Necessary,
            recorded_at: "fixed".into(),
        });
        store::append(&tx, &mut s, RecordKind::Decision).unwrap();
        if malformed.starts_with("$.decision") {
            tx.execute(
                "UPDATE review_events SET event=jsonb(json_remove(event,?1)) WHERE seq=1",
                [malformed],
            )
            .unwrap();
        } else {
            tx.execute("UPDATE review_parts SET payload=jsonb(json_remove(payload,?1)) WHERE id=(SELECT basis FROM review_events WHERE seq=1)", [malformed]).unwrap();
        }
        assert_eq!(code(store::get(&tx, 1).unwrap_err()), "REVIEWS_CORRUPT");
        assert_eq!(
            tx.query_row("SELECT COUNT(*) FROM review_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
#[test]
fn old_or_future_database_schema_is_rejected_without_deleting_user_records() {
    for version in [3, 99] {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('user decision');",
        )
        .unwrap();
        db.pragma_update(None, "user_version", version).unwrap();
        assert_eq!(
            code(store::initialize(&mut db).unwrap_err()),
            "UNSUPPORTED_VERSION"
        );
        assert_eq!(
            db.query_row("SELECT value FROM retained", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "user decision"
        );
    }
}
#[test]
fn empty_or_incomplete_checks_cannot_establish_decision_applicability() {
    let mut s = original(&view());
    for shape in [0, 1, 2] {
        let mut changed = s.clone();
        match shape {
            0 => changed.checks.clear(),
            1 => changed
                .checks
                .iter_mut()
                .for_each(|c| c.outcome = RuleOutcome::Miss),
            _ => changed.findings.clear(),
        }
        let binding = binding(&changed);
        assert!(binding.applicability_id.is_none());
        assert_eq!(binding.identity_basis, DecisionIdentityBasis::Unavailable);
        assert_eq!(
            binding.gap.as_deref(),
            Some("decisionApplicabilityUnavailable")
        );
    }
    s.checks.iter_mut().for_each(|c| c.assessment_id = None);
    assert!(binding(&s).applicability_id.is_none());
}
#[test]
fn weak_problem_identity_decision_is_limited_to_exact_suggestion_content_and_dependencies() {
    let v = view();
    let mut s = original(&v);
    s.findings[0].identity = FindingIdentity {
        version: 1,
        finding_id: None,
        gap: Some("problemLocationContextUnavailable".into()),
    };
    let decision = UserDecision {
        binding: binding(&s),
        kind: DecisionKind::Keep,
        reason: DecisionReason::Necessary,
        recorded_at: "fixed".into(),
    };
    assert!(decision.binding.finding_ids.is_empty());
    assert_eq!(
        decision.binding.identity_basis,
        DecisionIdentityBasis::ExactSuggestionVersion
    );
    assert!(decision_applies(&decision, &s));
    let mut changed = s.clone();
    changed.id = "another version bound group".into();
    assert!(!decision_applies(&decision, &changed));
    changed = s.clone();
    changed.item.content_hash = "changed".into();
    assert!(!decision_applies(&decision, &changed));
    changed = s.clone();
    changed
        .checks
        .iter_mut()
        .for_each(|c| c.basis.dependency_revision = Some("changed-safe-facts".into()));
    assert!(!decision_applies(&decision, &changed));
}
#[test]
fn declared_copy_hit_to_complete_miss_keeps_method_and_is_comparable() {
    // Synthetic safe relation truth, with no source reads or private collector state.
    let v = view();
    let p = RuleParameters::default();
    let input = Input::initial(&v, &v.items[0], &p, None);
    let mut f = original(&v).findings.remove(0);
    f.rule = "declaredCopyDrift".into();
    f.evidence = Some(StaticEvidence {
        method: "raw-utf8/identity-v1".into(),
        applicability: "userDeclaredCopy".into(),
        declaration_hash: None,
        relation_id: Some("copy".into()),
        direction: Some("sourceToCopy".into()),
        transform: Some("identity-v1".into()),
        versions: vec![],
        positions: vec![],
        relation: Some(RelationIdentity {
            source_instance_id: "source".into(),
            project: "/safe".into(),
            declaration_path: "/safe/.wombat/analysis.json".into(),
            declaration_hash: "declaration".into(),
            relation_id: "copy".into(),
            kind: RelationKind::Copy,
        }),
        references: vec![],
        hook: None,
    });
    f.identity = finding(&input, &f);
    assert!(f.identity.finding_id.is_some());
    let hit_methods = methods(Rule::DeclaredCopyDrift, &input, std::slice::from_ref(&f));
    let miss_methods = methods(Rule::DeclaredCopyDrift, &input, &[]);
    assert_eq!(hit_methods, miss_methods);
    assert_eq!(
        hit_methods
            .iter()
            .filter(|m| m.method == "raw-utf8/identity-v1")
            .count(),
        1
    );
    let mut old = file_check(&v, &p);
    old.rule = "declaredCopyDrift".into();
    old.findings = vec![f];
    old.method_versions = hit_methods;
    old.basis.measurement = RuleMeasurement::Static {
        complete: Some(true),
        findings: 1,
    };
    old.assessment_id = None;
    identify(&mut old);
    let old_scope = old.basis.scope.clone();
    let findings = old.findings.clone();
    let mut miss = old.clone();
    miss.outcome = RuleOutcome::Miss;
    miss.findings.clear();
    miss.method_versions = miss_methods;
    miss.basis.measurement = RuleMeasurement::Static {
        complete: Some(true),
        findings: 0,
    };
    miss.basis.dependency_revision = Some("repaired-related-content".into());
    miss.assessment_id = None;
    identify(&mut miss);
    miss.comparison = comparison(
        &miss,
        &Input {
            baseline: Some(Baseline {
                findings: &findings,
                assessments: std::slice::from_ref(&old),
                scope: &old_scope,
            }),
            ..input
        },
    );
    assert_eq!(miss.comparison.status, ComparisonStatus::Comparable);
    assert_eq!(reviews::status(&[miss], 1), "verified");
    let mut changed_declaration = findings[0].clone();
    changed_declaration
        .evidence
        .as_mut()
        .unwrap()
        .relation
        .as_mut()
        .unwrap()
        .declaration_hash = "new declaration content".into();
    assert_eq!(
        finding(&input, &changed_declaration).finding_id,
        findings[0].identity.finding_id
    );
}
#[test]
fn scope_and_source_authorization_are_checked_on_every_evaluation() {
    let v = view();
    let p = RuleParameters::default();
    let initial = evaluation::evaluate(
        &Input::initial(&v, &v.items[0], &p, None).with_source(Some("source")),
    );
    assert!(initial.iter().any(|c| c.outcome == RuleOutcome::Hit));
    let changed = evaluation::evaluate(
        &Input::initial(&v, &v.items[0], &p, None).with_source(Some("other-source")),
    );
    assert!(
        changed
            .iter()
            .all(|c| c.outcome == RuleOutcome::Insufficient
                && c.reason.as_deref() == Some("checkScopeUnavailable"))
    );
    assert!(changed.iter().all(
        |c| c.assessment_id.is_none() && c.basis.gaps.contains(&"checkScopeUnavailable".into())
    ));
    let project = evaluation::evaluate(&Input::initial(&v, &v.items[0], &p, Some("/unauthorized")));
    assert!(
        project
            .iter()
            .all(|c| c.outcome == RuleOutcome::Insufficient)
    );
}
#[test]
fn decision_after_observation_keeps_the_first_persisted_baseline_and_new_supporting_checks() {
    let mut db = rusqlite::Connection::open_in_memory().unwrap();
    store::initialize(&mut db).unwrap();
    let tx = db.transaction().unwrap();
    store::authorize(&tx, std::iter::once(("object", "object"))).unwrap();
    let mut v = view();
    let mut first = original(&v);
    store::append(&tx, &mut first, RecordKind::Observation).unwrap();
    let baseline = serde_json::to_value(&first.review_baseline).unwrap();
    v.checked = "2026-10-02T00:00:00Z".into();
    let later = original(&v);
    let expected_ids = binding(&later).assessment_ids;
    let states = store::states(&tx, None).unwrap();
    reviews::decide(
        &tx,
        &Request {
            action: Action::Keep,
            suggestion_id: Some(later.id.clone()),
            decision_reason: Some(DecisionReason::Necessary),
            ..Default::default()
        },
        std::slice::from_ref(&later),
        &states,
    )
    .unwrap();
    let decided = store::get(&tx, 2).unwrap();
    assert_eq!(
        serde_json::to_value(&decided.review_baseline).unwrap(),
        baseline
    );
    assert_eq!(
        decided.decision.unwrap().binding.assessment_ids,
        expected_ids
    );
}
#[test]
fn historical_verified_miss_never_hides_a_current_hit_with_the_same_group_identity() {
    let mut v = view();
    let p = RuleParameters::default();
    let mut previous = original(&v);
    let id = previous.id.clone();
    v.items[0].bytes = Some(0);
    v.items[0].content_hash = "fixed".into();
    let resolved = recheck(&v, &previous, &p);
    previous.status = reviews::status(std::slice::from_ref(&resolved), 1).into();
    previous.checks = vec![resolved];
    previous.item = v.items[0].clone();
    assert_eq!(previous.status, "verified");
    let current = detection::detect_for(&view(), &p, None, Some("source")).remove(0);
    assert_eq!(current.id, id);
    assert!(current.checks.iter().any(|c| c.outcome == RuleOutcome::Hit));
    assert!(!crate::optimize::service::suppresses(&previous, &current));
}
