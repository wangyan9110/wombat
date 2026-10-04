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
fn provisional_inventory_keeps_syncing_distinct_from_committed_partial_coverage() {
    let root = tempfile::tempdir().unwrap();
    for (issue, expected) in [
        (crate::adapters::codex::preview::ISSUE, "syncing"),
        ("syntheticCoverageGap", "partial"),
    ] {
        let mut collected = crate::adapters::contract::Collected::default();
        collected.issues.push(crate::adapters::contract::Issue {
            code: issue.into(),
            message: "synthetic".into(),
            source_instance_id: None,
            evidence: None,
        });
        let snapshot = crate::usage_store::memory(
            collected,
            "live:test:one".into(),
            crate::pricing_sync::current_at(root.path()).unwrap(),
            None,
        )
        .unwrap();
        let mut v = view();
        v.snapshot = Some(Arc::new(snapshot));
        v.history_status = "fixed".into();
        let result = execute(Request::default(), "config:test".into(), &v).unwrap();
        assert_eq!(result.coverage.history_status, expected);
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

fn use_operation(id: &str, kind: &str, status: &str) -> crate::adapters::contract::Operation {
    serde_json::from_value(serde_json::json!({
        "id": id, "threadId": "thread", "turnId": "turn", "callId": id,
        "kind": kind, "name": "read_file", "sequence": 1,
        "timestamp": "2026-10-04T00:00:00Z", "timePrecision": "second",
        "status": status, "evidence": []
    }))
    .unwrap()
}

fn use_view(mut operations: Vec<crate::adapters::contract::Operation>) -> View {
    let root = tempfile::tempdir().unwrap();
    let path = root
        .path()
        .join("synthetic-skill/SKILL.md")
        .to_string_lossy()
        .into_owned();
    for op in &mut operations {
        op.path = Some(path.clone());
    }
    let mut collected = crate::adapters::contract::Collected::default();
    collected.threads.push(crate::adapters::contract::Thread {
        id: "thread".into(),
        agent_kind: "codex".into(),
        source_instance_id: "source".into(),
        upstream_id: "native-thread".into(),
        title: None,
        project: None,
        started_at: None,
        last_activity_at: None,
    });
    collected.operations = operations.into_iter().map(Arc::new).collect();
    let snapshot = crate::usage_store::memory(
        collected,
        "live:uses:one".into(),
        crate::pricing_sync::current_at(root.path()).unwrap(),
        None,
    )
    .unwrap();
    let mut v = view();
    v.snapshot = Some(Arc::new(snapshot));
    v.history_status = "fixed".into();
    v.items.push(serde_json::from_value(serde_json::json!({
        "id":"skill", "name":"synthetic-skill", "kind":"skill",
        "sourceInstanceId":"source", "path":path, "authorizedProjects":[],
        "sourceContexts":[{"inventoryId":"skill-source", "global":true,
            "sourceInstanceId":"source", "contentHash":"synthetic", "configuredState":"enabled",
            "counts":{"fileReads":9,"toolCalls":0,"resourceReads":0,"succeeded":9,"failed":0,"outcomeUnknown":0},
            "observation":"used"}],
        "configuredState":"enabled", "contentHash":"synthetic", "observedAt":"now",
        "current":true, "stale":false, "estimateStatus":"unknown",
        "measurementStatus":"unknown", "bodyEstimateStatus":"unknown",
        "usageCount":9, "observation":"used",
        "counts":{"fileReads":9,"toolCalls":0,"resourceReads":0,"succeeded":9,"failed":0,"outcomeUnknown":0},
        "relatedTurns":9, "relatedTasks":9
    })).unwrap());
    v
}

fn uses_request() -> Request {
    Request {
        scope: Scope {
            all_time: Some(true),
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn declarations_and_catalogs_do_not_count_or_keep_cached_used_observations() {
    let v = use_view(vec![
        use_operation("declaration", "skillUse", "completed"),
        use_operation("catalog", "skillAvailable", "completed"),
    ]);
    let result = execute(uses_request(), "config:uses".into(), &v).unwrap();
    let item = &result.items[0];
    assert_eq!(item.usage_count, None);
    assert_eq!(item.observation, Observation::Unknown);
    assert_eq!(item.counts.file_reads, 0);
    assert_eq!((item.related_turns, item.related_tasks), (0, 0));
    assert_eq!(item.source_contexts[0].observation, Observation::Unknown);
    assert_eq!(item.source_contexts[0].counts.file_reads, 0);
}

#[test]
fn query_counts_three_skill_operations_in_one_turn_including_failure() {
    let first = use_operation("first", "skillRead", "completed");
    let v = use_view(vec![
        first.clone(),
        first,
        use_operation("second", "skillRead", "failed"),
        use_operation("third", "skillRead", "running"),
    ]);
    let mut request = uses_request();
    request.action = Action::Evidence;
    request.item_id = Some("skill".into());
    request.limit = Some(1);
    let result = execute(request, "config:uses".into(), &v).unwrap();
    let item = &result.items[0];
    assert_eq!(item.usage_count, Some(3));
    assert_eq!(item.observation, Observation::Used);
    assert_eq!((item.related_turns, item.related_tasks), (1, 1));
    assert_eq!(item.counts.file_reads, 3);
    assert_eq!(
        (
            item.counts.succeeded,
            item.counts.failed,
            item.counts.outcome_unknown
        ),
        (1, 1, 1)
    );
    assert_eq!(item.source_contexts[0].observation, Observation::Used);
    assert_eq!(item.source_contexts[0].counts.failed, 1);
    assert_eq!(result.page.total, 3);
    assert_eq!(result.evidence.len(), 1);
    assert!(item.usage.is_none());
}

#[test]
fn wrapper_literal_read_keeps_a_candidate_without_claiming_actual_dispatch() {
    let mut wrapper = use_operation("wrapper-path-hash", "skillRead", "completed");
    wrapper.name = "read_skill_file".into();
    wrapper.call_id = None;
    let v = use_view(vec![wrapper]);
    let result = execute(uses_request(), "config:uses".into(), &v).unwrap();
    let item = &result.items[0];
    assert_eq!(item.observation, Observation::Unknown);
    assert_eq!(item.usage_count, None);
    assert_eq!((item.related_turns, item.related_tasks), (0, 0));
    assert_eq!(item.counts.file_reads, 0);
    assert!(
        result
            .coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1DispatchUnknown"
                && issue.path.as_ref() == Some(&item.path))
    );
    let mut request = uses_request();
    request.action = Action::Evidence;
    request.item_id = Some("skill".into());
    let evidence = execute(request, "config:uses".into(), &v).unwrap();
    assert_eq!(evidence.evidence.len(), 1);
    assert_eq!(evidence.evidence[0].event_type, "skill_read_candidate");
    assert_eq!(evidence.evidence[0].association, "operationDispatchUnknown");
    assert!(evidence.evidence[0].usage.is_none());
}

#[test]
fn explicit_read_without_native_identity_is_used_but_its_count_is_unknown() {
    let mut read = use_operation("anonymous-read", "skillRead", "failed");
    read.call_id = None;
    read.turn_id = None;
    let v = use_view(vec![read]);
    let result = execute(uses_request(), "config:uses".into(), &v).unwrap();
    assert_eq!(result.items[0].observation, Observation::Used);
    assert_eq!(
        result.items[0].source_contexts[0].observation,
        Observation::Used
    );
    assert_eq!(result.items[0].usage_count, None);
    assert_eq!(result.items[0].related_turns, 0);
    assert_eq!(result.items[0].related_tasks, 1);
    assert_eq!(result.items[0].counts.file_reads, 1);
    assert!(
        result
            .coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1IdentityUnknown")
    );
}

#[test]
fn mcp_calls_and_resource_reads_share_operation_counts_but_discovery_does_not() {
    let mut ops = vec![
        use_operation("tool", "mcpTool", "failed"),
        use_operation("resource", "mcpResource", "unknown"),
        use_operation("discovery", "mcpDiscovery", "completed"),
    ];
    for op in &mut ops {
        op.server = Some("server".into());
        op.tool = Some("tool".into());
    }
    let mut v = use_view(ops.clone());
    v.items[0].kind = Kind::Mcp;
    v.items[0].native_key = Some("server".into());
    let result = execute(uses_request(), "config:uses".into(), &v).unwrap();
    assert_eq!(result.items[0].usage_count, Some(2));
    assert_eq!(result.items[0].observation, Observation::Used);
    assert_eq!(
        (
            result.items[0].counts.tool_calls,
            result.items[0].counts.resource_reads
        ),
        (1, 1)
    );
    assert_eq!(result.items[0].related_turns, 1);

    // Adapter conflicts deliberately erase unreliable server attribution.
    ops.push(use_operation("conflict", "mcpConflict", "failed"));
    let mut conflict = use_view(ops);
    conflict.items[0].kind = Kind::Mcp;
    conflict.items[0].native_key = Some("server".into());
    let result = execute(uses_request(), "config:uses".into(), &conflict).unwrap();
    assert_eq!(result.items[0].usage_count, None);
    assert!(
        result
            .coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1TargetUnknown")
    );
}

#[test]
fn ambiguous_inventory_targets_keep_candidate_gaps_instead_of_picking_an_item() {
    let mut v = use_view(vec![use_operation("read", "skillRead", "completed")]);
    let mut second_version = v.items[0].clone();
    second_version.id = "second-version".into();
    second_version.content_hash = "different-current-content".into();
    v.items.push(second_version);
    let result = execute(uses_request(), "config:uses".into(), &v).unwrap();
    assert_eq!(result.items.len(), 2);
    for item in &result.items {
        assert_eq!(item.usage_count, None);
        assert_eq!(item.observation, Observation::Unknown);
        assert_eq!(item.counts.file_reads, 0);
        assert!(
            result
                .coverage
                .issues
                .iter()
                .any(|issue| issue.code == "usageCountV1TargetUnknown"
                    && issue.path.as_ref() == Some(&item.path))
        );
    }
}

#[test]
fn missing_time_prevents_a_precise_date_window_count_without_creating_a_turn() {
    let mut missing = use_operation("missing-time", "skillRead", "failed");
    missing.timestamp = None;
    missing.turn_id = None;
    let v = use_view(vec![
        use_operation("known-time", "skillRead", "completed"),
        missing,
    ]);
    let request = Request {
        scope: Scope {
            since: Some("2026-10-04".into()),
            until: Some("2026-10-05".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let result = execute(request, "config:uses".into(), &v).unwrap();
    assert_eq!(result.items[0].usage_count, None);
    assert_eq!(result.items[0].related_turns, 1);
    assert!(
        result
            .coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1TimeUnknown")
    );
    let all = execute(uses_request(), "config:uses".into(), &v).unwrap();
    assert_eq!(all.items[0].usage_count, Some(2));
    assert_eq!(all.items[0].counts.file_reads, 2);
    assert_eq!(all.items[0].related_turns, 1);
    assert!(
        all.coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1TurnUnknown")
    );
}

#[test]
fn thread_scope_retains_read_candidates_and_their_queryable_evidence() {
    let mut wrapper = use_operation("wrapper-path-hash", "skillRead", "completed");
    wrapper.name = "read_skill_file".into();
    wrapper.call_id = None;
    let v = use_view(vec![wrapper]);
    let mut request = uses_request();
    request.scope.thread_id = Some("thread".into());
    let list = execute(request.clone(), "config:uses".into(), &v).unwrap();
    assert_eq!(list.items.len(), 1);
    assert_eq!(list.items[0].observation, Observation::Unknown);
    assert_eq!(list.items[0].usage_count, None);
    assert_eq!(list.items[0].counts.file_reads, 0);
    assert_eq!(list.summary.observed_items, 0);
    assert!(
        list.coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1DispatchUnknown")
    );
    request.action = Action::Evidence;
    request.item_id = Some("skill".into());
    let evidence = execute(request, "config:uses".into(), &v).unwrap();
    assert_eq!(evidence.items.len(), 1);
    assert_eq!(evidence.page.total, 1);
    assert_eq!(evidence.evidence[0].event_type, "skill_read_candidate");
    assert_eq!(evidence.evidence[0].association, "operationDispatchUnknown");
    assert!(evidence.evidence[0].usage.is_none());
}

#[test]
fn thread_scope_retains_missing_time_coverage_without_inventing_evidence_dates() {
    let mut read = use_operation("known-call-without-time", "skillRead", "failed");
    read.timestamp = None;
    let v = use_view(vec![read]);
    let request = Request {
        action: Action::Evidence,
        item_id: Some("skill".into()),
        scope: Scope {
            thread_id: Some("thread".into()),
            since: Some("2026-10-04".into()),
            until: Some("2026-10-05".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let result = execute(request, "config:uses".into(), &v).unwrap();
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].usage_count, None);
    assert_eq!(result.items[0].counts.file_reads, 0);
    assert!(result.evidence.is_empty());
    assert_eq!(result.page.total, 0);
    assert!(
        result
            .coverage
            .issues
            .iter()
            .any(|issue| issue.code == "usageCountV1TimeUnknown")
    );
}

#[test]
fn unmatched_operation_from_another_project_does_not_pollute_selected_coverage() {
    let mut v = use_view(vec![use_operation("unassigned-mcp", "mcpTool", "failed")]);
    let project = "/synthetic/selected-project";
    v.projects.push(project.into());
    // This global inventory item applies to the selected project. The operation's
    // thread has no selected-project association, so it is outside that history scope.
    let mut request = uses_request();
    request.scope.project = Some(project.into());
    let result = execute(request, "config:uses".into(), &v).unwrap();
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].observation, Observation::Unknown);
    assert!(!result.coverage.issues.iter().any(|issue| matches!(
        issue.code.as_str(),
        "usageOperationTargetUnknown" | "usageCountV1TargetUnknown"
    )));
}
