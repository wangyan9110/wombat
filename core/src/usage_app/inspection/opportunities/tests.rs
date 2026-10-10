use super::runtime::poll_states;
use super::*;
use crate::session_events::{Position, Time};
fn event(n: u64, seconds: u64, payload: Payload) -> Arc<Event> {
    Arc::new(
        Event::new(
            Position {
                source_instance_id: "synthetic".into(),
                file_id: "synthetic-file".into(),
                generation: "one".into(),
                byte_offset: n,
                ordinal: 0,
            },
            Some("a".into()),
            Some("u".into()),
            Time::from_source(Some(&format!(
                "2026-09-09T00:{:02}:{:02}Z",
                seconds / 60,
                seconds % 60
            )))
            .0,
            vec![],
            payload,
        )
        .unwrap(),
    )
}
fn op(id: &str, status: &str) -> Operation {
    Operation {
        text_result: None,
        id: id.into(),
        thread_id: "a".into(),
        turn_id: Some("u".into()),
        item_id: None,
        call_id: Some(id.into()),
        response_id: None,
        kind: "command".into(),
        name: "exec_command".into(),
        sequence: 0,
        timestamp: Some("2026-09-09T00:00:00Z".into()),
        time_precision: "second".into(),
        status: status.into(),
        exit_code: None,
        outcome_conflict: false,
        duration_ms: None,
        path: None,
        work: None,
        matching: None,
        server: None,
        tool: None,
        evidence: vec![],
    }
}
fn check(review: &OpportunityReview, rule: Rule) -> &OpportunityCheck {
    review.checks.iter().find(|c| c.rule == rule).unwrap()
}
#[test]
fn lexical_paths_never_use_substrings_or_host_platform() {
    assert_eq!(outside("/work/app", "/work/apple/.env"), Some(true));
    assert_eq!(outside("/work/app", "/work/app/src/x"), Some(false));
    assert_eq!(outside("/work/app", "../.env"), None);
    assert_eq!(
        outside("C:\\WORK\\App", "c:\\work\\app\\src\\x"),
        Some(false)
    );
    assert!(sensitive("C:\\work\\.env.production"));
    assert!(!sensitive("/work/environment.rs"));
}
#[test]
fn explicit_question_results_do_not_infer_answers_from_task_completion() {
    let s = super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 1)], "questions");
    let scope = Scope {
        all_time: Some(true),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().collect::<Vec<_>>();
    let question = event(
        0,
        0,
        Payload::Review {
            observation: R::Question {
                call_id: "q".into(),
                question_ids: vec![crate::hash("first"), crate::hash("second")],
            },
        },
    );
    let reply = event(
        1,
        30,
        Payload::Review {
            observation: R::Reply {
                call_id: "q".into(),
                answered_ids: Some(vec![crate::hash("first")]),
                permissions_returned: None,
                empty_output: None,
            },
        },
    );
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &[],
        &[question.clone(), reply.clone()],
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(check(&r, Rule::UnansweredQuestion).finding_count, 1);
    assert_eq!(check(&r, Rule::LongInteraction).finding_count, 1);
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &[],
        &[question],
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(
        check(&r, Rule::UnansweredQuestion).status,
        OpportunityStatus::Insufficient
    );
    assert_eq!(check(&r, Rule::LongInteraction).finding_count, 0);
}
#[test]
fn security_requires_exact_native_request_path_and_decline_evidence() {
    let s = super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 1)], "security");
    let scope = Scope {
        all_time: Some(true),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().collect::<Vec<_>>();
    let target = adapters::review_target("/a", ".env").unwrap();
    let mut read = op("read", "completed");
    read.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: WorkStage::Terminal,
        data: WorkData::Command {
            cwd: Some("/a".into()),
            source: Some(CommandSource::Agent),
            parsed_commands: Some(vec![]),
        },
        gaps: vec![],
    });
    read.matching = Some(OperationMatchObservation {
        format_version: OPERATION_MATCH_VERSION,
        receiver_owner: Some("a".into()),
        request_fingerprint: None,
        function_request_fingerprint: None,
        read_targets: vec![target.clone()],
        expected_nonzero: false,
        gaps: vec![],
    });
    let operations = vec![
        read.clone(),
        op("outbound", "completed"),
        op("risk1", "declined"),
        op("risk2", "declined"),
    ];
    let mut events = vec![event(
        0,
        0,
        Payload::Operation {
            value: Arc::new(read),
            phase: crate::session_events::Phase::Completed,
        },
    )];
    events.push(event(
        1,
        10,
        Payload::Review {
            observation: R::Safety {
                operation_id: Some("outbound".into()),
                request_key: None,
                labels: vec![],
                outbound_targets: vec![target],
                complete: true,
            },
        },
    ));
    for (n, id) in [(2, "risk1"), (3, "risk2")] {
        events.push(event(
            n,
            20,
            Payload::Review {
                observation: R::Safety {
                    operation_id: Some(id.into()),
                    request_key: Some(crate::hash("same-request")),
                    labels: vec![L::BroadDeletion],
                    outbound_targets: vec![],
                    complete: true,
                },
            },
        ));
    }
    events.push(events[2].clone()); // Native replay must not create a third rejection.
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &operations,
        &events,
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(check(&r, Rule::SensitiveRead).finding_count, 1);
    assert_eq!(check(&r, Rule::SensitiveOutbound).finding_count, 1);
    assert_eq!(check(&r, Rule::RiskyCommand).finding_count, 2);
    assert_eq!(check(&r, Rule::RepeatedRiskyDecline).finding_count, 1);
    assert_eq!(
        check(&r, Rule::RiskyCommand).findings[0].safety_labels,
        vec![L::BroadDeletion]
    );
    assert!(check(&r, Rule::SecretExposure).findings.is_empty());
}
#[test]
fn estimated_amounts_use_full_ledger_and_equal_nonoverlapping_windows() {
    let s = super::super::tests::snapshot(
        &[
            ("p", "a", "2026-09-02T00:00:00Z", 500_000),
            ("a", "a", "2026-09-09T00:00:00Z", 4_000_000),
            ("b", "b", "2026-09-09T00:00:00Z", 500_000),
            ("c", "c", "2026-09-09T00:00:00Z", 500_000),
            ("d", "d", "2026-09-09T00:00:00Z", 500_000),
            ("e", "e", "2026-09-09T00:00:00Z", 500_000),
        ],
        "cost",
    );
    let scope = Scope {
        since: Some("2026-09-08".into()),
        until: Some("2026-09-15".into()),
        ..Default::default()
    };
    let before = Scope {
        since: Some("2026-09-01".into()),
        until: Some("2026-09-08".into()),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().filter(|r| r.fact.id != "p").collect::<Vec<_>>();
    let previous = rows.iter().filter(|r| r.fact.id == "p").collect::<Vec<_>>();
    let mut b = Builder::new(&s, &scope, &selected, Some((&before, &previous))).unwrap();
    for t in &s.manifest.threads {
        b.operation_counts.insert(t.thread.id.clone(), 2);
    }
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(check(&r, Rule::EstimateConcentration).finding_count, 1);
    assert_eq!(check(&r, Rule::EstimateOutlier).finding_count, 1);
    assert_eq!(check(&r, Rule::EstimateIncrease).finding_count, 1);
    assert_eq!(check(&r, Rule::ModelReview).finding_count, 1);
    assert_eq!(
        check(&r, Rule::EstimateIncrease).findings[0].baseline_evidence[0]
            .scope
            .since,
        before.since
    );
    assert_eq!(check(&r, Rule::UnpricedUsage).finding_count, 0);
    assert_eq!(r.checks.len(), 17);
}

#[test]
fn cache_and_unpriced_checks_keep_unknown_and_below_threshold_distinct() {
    let base =
        super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 200_000)], "cache");
    let rows = base.ledger().unwrap();
    let mut measurement = (*rows[0].fact).clone();
    measurement.model.raw = Some("synthetic-unpriced".into());
    measurement.tokens.input = Some(100_000);
    measurement.tokens.cache_create = Some(100_000);
    let collected = Collected {
        sources: base.manifest.sources.clone(),
        threads: base
            .manifest
            .threads
            .iter()
            .map(|t| t.thread.clone())
            .collect(),
        measurements: vec![Arc::new(measurement)],
        ..Default::default()
    };
    let root = tempfile::tempdir().unwrap();
    let s = crate::usage_store::memory(
        collected,
        "live:synthetic:cache-review".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap();
    let scope = Scope {
        all_time: Some(true),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().collect::<Vec<_>>();
    let r = Builder::new(&s, &scope, &selected, None)
        .unwrap()
        .finish(&s, chrono_tz::UTC)
        .unwrap();
    assert_eq!(check(&r, Rule::UnpricedUsage).finding_count, 1);
    assert_eq!(check(&r, Rule::CacheCreationReuse).finding_count, 1);
    assert_eq!(
        check(&r, Rule::EstimateConcentration).status,
        OpportunityStatus::Insufficient
    );
    let mut rows = rows;
    let mut m = (*rows[0].fact).clone();
    m.tokens.cache_create = None;
    m.token_unavailable_reasons = m
        .tokens
        .unavailable_reasons(TokenUnavailableReason::Missing);
    rows[0].fact = Arc::new(m);
    let selected = rows.iter().collect::<Vec<_>>();
    let r = Builder::new(&s, &scope, &selected, None)
        .unwrap()
        .finish(&s, chrono_tz::UTC)
        .unwrap();
    assert_eq!(
        check(&r, Rule::CacheCreationReuse).status,
        OpportunityStatus::Insufficient
    );
}
#[test]
fn explicit_permissions_and_reported_changes_keep_their_native_scope() {
    let s = super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 1)], "permissions");
    let scope = Scope {
        all_time: Some(true),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().collect::<Vec<_>>();
    let mut change = op("change", "declined");
    change.kind = "file".into();
    change.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: WorkStage::Proposed,
        data: WorkData::FileChange {
            changes: Some(vec![FilePathChange {
                path: "/another/.env".into(),
                change: ChangeKind::Update,
                move_path: None,
            }]),
        },
        gaps: vec![],
    });
    let mut operations = vec![change];
    let mut events = vec![];
    for n in 0..5 {
        let id = format!("permission-{n}");
        operations.push(op(&id, "completed"));
        events.push(event(
            n,
            n,
            Payload::Review {
                observation: R::Permission { call_id: id },
            },
        ));
    }
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &operations,
        &events,
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(check(&r, Rule::PermissionFriction).finding_count, 1);
    assert_eq!(check(&r, Rule::SensitiveChange).finding_count, 1);
    assert_eq!(check(&r, Rule::OutsideProjectChange).finding_count, 1);
    assert_eq!(
        check(&r, Rule::LongInteraction).status,
        OpportunityStatus::Insufficient
    );
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &operations,
        &events[..4],
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    assert_eq!(check(&r, Rule::PermissionFriction).finding_count, 0);
}
#[test]
fn short_poll_chains_require_running_boundary_and_no_intervening_input() {
    let start = event(
        0,
        0,
        Payload::Lifecycle {
            lifecycle: LifecycleKind::Turn,
            phase: crate::session_events::Phase::Started,
            native_id: Some("u".into()),
            duration_ms: None,
            first_token_ms: None,
        },
    );
    let request = |n, empty_input| {
        event(
            n,
            n,
            Payload::Review {
                observation: R::Poll {
                    call_id: format!("poll-{n}"),
                    process_key: crate::hash("process"),
                    empty_input,
                    wait_ms: 1000,
                },
            },
        )
    };
    let response = |n, call| {
        event(
            n,
            n,
            Payload::Review {
                observation: R::Reply {
                    call_id: format!("poll-{call}"),
                    answered_ids: None,
                    permissions_returned: None,
                    empty_output: Some(true),
                },
            },
        )
    };
    let events = [
        start,
        request(1, true),
        response(2, 1),
        request(3, false),
        response(4, 3),
        request(5, true),
    ];
    let refs = events.iter().collect::<Vec<_>>();
    let states = poll_states(&refs);
    assert!(states[events[1].id()].0);
    assert_ne!(states[events[2].id()].2, states[events[5].id()].2);
    let refs = events[1..].iter().collect::<Vec<_>>();
    let states = poll_states(&refs);
    assert!(!states[events[1].id()].0);
}

#[test]
fn omitted_prompt_findings_preserve_retained_identities_and_complete_count() {
    let s =
        super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 1)], "bounded-identity");
    let scope = Scope {
        all_time: Some(true),
        ..Default::default()
    };
    let rows = s.ledger().unwrap();
    let selected = rows.iter().collect::<Vec<_>>();
    let events = (0..6)
        .map(|n| {
            event(
                n,
                n,
                Payload::Review {
                    observation: R::Safety {
                        operation_id: None,
                        request_key: None,
                        labels: vec![L::PossibleCredential],
                        outbound_targets: vec![],
                        complete: true,
                    },
                },
            )
        })
        .collect::<Vec<_>>();
    let mut b = Builder::new(&s, &scope, &selected, None).unwrap();
    b.thread(
        &s,
        &scope,
        &s.manifest.threads[0],
        &[],
        &events,
        &selected,
        chrono_tz::UTC,
    )
    .unwrap();
    let r = b.finish(&s, chrono_tz::UTC).unwrap();
    let c = check(&r, Rule::SecretExposure);
    assert_eq!(c.finding_count, 6);
    assert_eq!(c.findings.len(), 3);
    for (f, e) in c.findings.iter().zip(&events) {
        assert_eq!(
            f.id,
            crate::hash(serde_json::to_vec(&(Rule::SecretExposure, e.id())).unwrap())
        );
        assert_eq!(f.metrics[0].name, M::Samples);
    }
}
#[test]
fn invalid_view_cutoff_returns_a_structured_error() {
    let mut s =
        super::super::tests::snapshot(&[("m", "a", "2026-09-09T00:00:00Z", 1)], "invalid-cutoff");
    s.manifest.snapshot_ref.created_at = "unknown".into();
    let r = serde_json::from_value(
        serde_json::json!({"action":"investigate","scope":{"allTime":true,"timezone":"UTC"}}),
    )
    .unwrap();
    let error = super::super::execute(r, &s).err().unwrap();
    assert_eq!(
        error
            .downcast_ref::<crate::dto::OperationError>()
            .unwrap()
            .code,
        "INVALID_ARGUMENT"
    );
}
