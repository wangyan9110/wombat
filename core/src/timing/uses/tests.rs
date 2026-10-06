use super::*;
fn thread() -> Thread {
    Thread {
        id: "thread".into(),
        source_instance_id: "source".into(),
        agent_kind: "codex".into(),
        upstream_id: "native".into(),
        title: None,
        project: Some("/synthetic/project".into()),
        started_at: None,
        last_activity_at: None,
    }
}
fn operation(id: &str, kind: &str) -> Arc<Operation> {
    Arc::new(serde_json::from_value(serde_json::json!({"id":id,"threadId":"thread","turnId":"turn","callId":id,"kind":kind,"name":"read_file","path":"/synthetic/skill/SKILL.md","server":"server","tool":"search","sequence":1,"timestamp":"2026-10-04T00:00:00Z","timePrecision":"second","status":"completed","outcomeConflict":false,"evidence":[]})).unwrap())
}
fn input<'a>(
    thread: &'a Thread,
    operations: &'a [Arc<Operation>],
    cancelled: &'a AtomicBool,
) -> Input<'a> {
    Input {
        thread,
        turn: "turn",
        source: None,
        operations,
        membership: MembershipCoverage::default(),
        budget: Budget::default(),
        cancelled,
    }
}
#[test]
fn exact_turn_operations_do_not_prove_unassigned_membership_absent() {
    let thread = thread();
    let operations = [operation("read", "skillRead")];
    let cancelled = AtomicBool::new(false);
    let out = project(input(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.method_version, usage_observations::METHOD_VERSION);
    assert_eq!(out.objects[0].associated_use_count, Some(1));
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].unassigned_turn_records, None);
    assert_eq!(out.source_coverage, SourceCoverage::Unknown);
    assert_eq!(out.membership.mcp, None);
    assert_eq!(out.records[0].state, UseState::Used);
}
fn source(status: &str) -> SourceReport {
    SourceReport {
        source: crate::adapters::contract::SourceInstance {
            id: "source".into(),
            agent_kind: "codex".into(),
            root: "/synthetic/source".into(),
        },
        adapter_version: "synthetic-v1".into(),
        source_versions: vec![],
        capabilities: Default::default(),
        status: status.into(),
        files_read: 1,
        bytes_read: 1,
        issues: vec![],
    }
}
fn confirmed<'a>(
    thread: &'a Thread,
    operations: &'a [Arc<Operation>],
    cancelled: &'a AtomicBool,
) -> Input<'a> {
    Input {
        membership: MembershipCoverage {
            skill: Some(0),
            mcp: Some(0),
        },
        ..input(thread, operations, cancelled)
    }
}
fn code(error: anyhow::Error) -> &'static str {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
}
#[test]
fn three_reads_replays_and_failed_retries_use_the_shared_projection() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let first = operation("one", "skillRead");
    let mut failed = operation("two", "skillRead").as_ref().clone();
    failed.status = "failed".into();
    let mut retry = operation("three", "skillRead").as_ref().clone();
    retry.status = "interrupted".into();
    let operations = [first.clone(), first, Arc::new(failed), Arc::new(retry)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    let mut common = Projection::default();
    for op in &operations {
        common.observe(op);
    }
    assert_eq!(out.objects[0].use_count, common.count(false));
    assert_eq!(out.objects[0].use_count, Some(3));
    assert_eq!(out.objects[0].records, vec![0, 1, 2, 3]);
    assert_eq!(out.records[1].replay_of, Some(0));
    assert_eq!(out.records[2].operation.status.as_ref(), "failed");
    assert!(out.records.iter().all(|r| r.identity_known));
    assert_eq!(out.objects[0].coverage.identity_gaps, 0);
}
#[test]
fn native_identity_absent_is_still_used_with_unknown_count_and_time() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut anonymous = operation("physical-hash", "skillRead").as_ref().clone();
    anonymous.call_id = None;
    anonymous.timestamp = None;
    let operations = [Arc::new(anonymous.clone()), Arc::new(anonymous)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].associated_use_count, Some(0));
    assert_eq!(out.objects[0].coverage.identity_gaps, 2);
    assert_eq!(out.coverage.time_gaps, 2);
    assert!(out.records.iter().all(|r| r.state == UseState::Used
        && !r.identity_known
        && r.replay_of.is_none()
        && r.time_basis == TimeBasis::Unknown));
}
#[test]
fn missing_time_preserves_confirmed_all_time_identity_count() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut op = operation("native", "skillRead").as_ref().clone();
    op.timestamp = Some("not-time".into());
    op.duration_ms = Some(42);
    let operations = [Arc::new(op)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects[0].use_count, Some(1));
    assert_eq!(out.objects[0].coverage.time_gaps, 1);
    assert_eq!(out.records[0].time_basis, TimeBasis::Unknown);
    assert_eq!(out.records[0].operation.duration_ms, Some(42));
}
#[test]
fn wrapper_candidates_catalogs_and_generic_unknown_reads_are_not_uses() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut candidate = operation("wrapper", "skillRead").as_ref().clone();
    candidate.name = "read_skill_file".into();
    let mut generic = operation("unknown-path", "tool").as_ref().clone();
    generic.path = None;
    let operations = [
        Arc::new(candidate),
        Arc::new(generic),
        operation("catalog", "skillCatalog"),
        operation("available", "skillAvailable"),
        operation("discovery", "mcpDiscovery"),
    ];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.records.len(), 1);
    assert_eq!(out.records[0].state, UseState::Candidate);
    assert_eq!(out.objects.len(), 1);
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].coverage.dispatch_gaps, 1);
    assert_eq!(out.coverage.target_gaps, 0);
    assert_eq!(out.coverage.dispatch_gaps, 1);
    let unrelated = [operation("true-read", "skillRead"), operations[1].clone()];
    assert_eq!(
        project(confirmed(&thread, &unrelated, &cancelled))
            .unwrap()
            .objects[0]
            .use_count,
        Some(1)
    );
}

#[test]
fn known_associated_use_survives_a_local_dispatch_gap() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let known = operation("known", "skillRead");
    let mut candidate = operation("candidate", "skillRead").as_ref().clone();
    candidate.name = "read_skill_file".into();
    let operations = [known, Arc::new(candidate)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 1);
    assert_eq!(out.objects[0].associated_use_count, Some(1));
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].coverage.dispatch_gaps, 1);
}

#[test]
fn zero_observed_uses_is_preserved_when_dispatch_is_unproven() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut candidate = operation("candidate", "skillRead").as_ref().clone();
    candidate.name = "read_skill_file".into();
    let operations = [Arc::new(candidate)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects[0].associated_use_count, Some(0));
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].coverage.dispatch_gaps, 1);
}
#[test]
fn unknown_explicit_targets_and_mcp_ambiguity_do_not_create_named_objects_or_precise_counts() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut unknown_skill = operation("unknown-skill", "skillRead").as_ref().clone();
    unknown_skill.path = None;
    let mut unknown_mcp = operation("unknown-server", "mcpTool").as_ref().clone();
    unknown_mcp.server = None;
    let mut resource = operation("resource", "mcpResource").as_ref().clone();
    resource.path = None;
    resource.tool = Some("read_mcp_resource".into());
    let operations = [
        operation("skill", "skillRead"),
        operation("tool", "mcpTool"),
        Arc::new(resource),
        Arc::new(unknown_skill),
        Arc::new(unknown_mcp),
        operation("unclassified", "mcpUnclassified"),
        operation("conflict", "mcpConflict"),
    ];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 2);
    assert_eq!(out.objects[0].coverage.target_gaps, 1);
    assert_eq!(out.objects[1].coverage.target_gaps, 3);
    assert!(out.objects.iter().all(|o| o.use_count.is_none()));
    assert_eq!(out.unassigned_records, vec![3, 4]);
    assert_eq!(out.records[3].state, UseState::Used);
    assert_eq!(out.records[4].state, UseState::Used);
    assert_eq!(out.records[5].state, UseState::Unclassified);
    assert_eq!(out.coverage.target_gaps, 4);
}
#[test]
fn mcp_resource_and_tool_share_server_object_without_uri_or_current_configuration() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let mut resource = operation("resource", "mcpResource").as_ref().clone();
    resource.path = None;
    let operations = [operation("tool", "mcpTool"), Arc::new(resource)];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 1);
    assert_eq!(out.objects[0].use_count, Some(2));
    assert_eq!(out.objects[0].coverage.target_gaps, 0);
    assert_eq!(
        out.objects[0].key.as_ref(),
        &ObjectKey::Mcp {
            source: "source".into(),
            project: Some("/synthetic/project".into()),
            server: "server".into()
        }
    );
}
#[test]
fn lexical_targets_require_historical_absolute_project_and_preserve_distinct_paths() {
    let mut owner = thread();
    let cancelled = AtomicBool::new(false);
    let mut relative = operation("relative", "skillRead").as_ref().clone();
    relative.path = Some("skills/../skill/SKILL.md".into());
    let mut second = operation("second", "skillRead").as_ref().clone();
    second.path = Some("/synthetic/other/SKILL.md".into());
    let operations = [Arc::new(relative), Arc::new(second)];
    let out = project(confirmed(&owner, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 2);
    assert_eq!(
        out.objects[0].key.as_ref(),
        &ObjectKey::Skill {
            source: "source".into(),
            path: "/synthetic/project/skill/SKILL.md".into()
        }
    );
    owner.project = Some("relative-cwd".into());
    let out = project(confirmed(&owner, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 1);
    assert_eq!(out.unassigned_records, vec![0]);
    assert_eq!(out.objects[0].use_count, None);
}
#[test]
fn conflicting_canonical_targets_never_merge_by_name_or_first_wins() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let first = operation("same", "skillRead");
    let mut conflict = first.as_ref().clone();
    conflict.path = Some("/synthetic/other/SKILL.md".into());
    let independent = operation("independent", "skillRead");
    let operations = [
        first.clone(),
        first.clone(),
        Arc::new(conflict),
        first,
        independent,
    ];
    let out = project(confirmed(&thread, &operations, &cancelled)).unwrap();
    assert_eq!(out.objects.len(), 2);
    assert!(out.objects.iter().all(|o| o.use_count.is_none()));
    assert_eq!(out.objects[0].associated_use_count, Some(1));
    assert_eq!(out.objects[1].associated_use_count, Some(0));
    assert!(out.records[..4].iter().all(|r| r.target_conflict));
    assert!(!out.records[4].target_conflict);
    assert_eq!(out.coverage.target_gaps, 1);
}
#[test]
fn source_coverage_and_unassigned_metadata_remain_independent_of_observed_counts() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let operations = [operation("read", "skillRead")];
    let source = source("partial");
    let out = project(Input {
        source: Some(&source),
        ..confirmed(&thread, &operations, &cancelled)
    })
    .unwrap();
    assert_eq!(out.objects[0].use_count, Some(1));
    assert_eq!(out.source_coverage, SourceCoverage::Partial);
    let out = project(Input {
        membership: MembershipCoverage {
            skill: Some(2),
            mcp: Some(0),
        },
        ..confirmed(&thread, &operations, &cancelled)
    })
    .unwrap();
    assert_eq!(out.objects[0].associated_use_count, Some(1));
    assert_eq!(out.objects[0].use_count, None);
    assert_eq!(out.objects[0].unassigned_turn_records, Some(2));
    let empty = project(input(&thread, &[], &cancelled)).unwrap();
    assert!(empty.objects.is_empty());
    assert_eq!(empty.membership.skill, None);
}
#[test]
fn scope_budget_and_cancellation_errors_never_return_a_successful_prefix() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    let operations = [operation("read", "skillRead")];
    for budget in [
        Budget {
            operations: 0,
            ..Default::default()
        },
        Budget {
            string_bytes: 1,
            ..Default::default()
        },
    ] {
        assert_eq!(
            code(
                project(Input {
                    budget,
                    ..input(&thread, &operations, &cancelled)
                })
                .unwrap_err()
            ),
            "RESOURCE_LIMIT"
        );
    }
    let large_identity = [operation(&"x".repeat(256), "skillRead")];
    assert_eq!(
        code(
            project(Input {
                budget: Budget {
                    string_bytes: 200,
                    ..Default::default()
                },
                ..input(&thread, &large_identity, &cancelled)
            })
            .unwrap_err()
        ),
        "RESOURCE_LIMIT"
    );
    let mut foreign = operations[0].as_ref().clone();
    foreign.turn_id = None;
    let invalid = [operations[0].clone(), Arc::new(foreign)];
    assert_eq!(
        code(project(input(&thread, &invalid, &cancelled)).unwrap_err()),
        "SNAPSHOT_CORRUPT"
    );
    let mut foreign_source = source("complete");
    foreign_source.source.id = "foreign".into();
    assert_eq!(
        code(
            project(Input {
                source: Some(&foreign_source),
                ..input(&thread, &operations, &cancelled)
            })
            .unwrap_err()
        ),
        "INVALID_ARGUMENT"
    );
    cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        code(project(input(&thread, &operations, &cancelled)).unwrap_err()),
        "CANCELLED"
    );
}
#[test]
fn unknown_replay_targets_poison_the_same_family_in_both_input_orders() {
    let thread = thread();
    let cancelled = AtomicBool::new(false);
    for (kind, ambiguous) in [("skillRead", false), ("mcpTool", false), ("mcpTool", true)] {
        let first = operation("same", kind);
        let mut unknown = first.as_ref().clone();
        if kind == "skillRead" {
            unknown.path = None;
        } else if ambiguous {
            unknown.kind = "mcpUnclassified".into();
        } else {
            unknown.server = None;
        }
        let unknown = Arc::new(unknown);
        let mut independent = operation("other", kind).as_ref().clone();
        independent.path = Some("/synthetic/other/SKILL.md".into());
        independent.server = Some("other-server".into());
        let independent = Arc::new(independent);
        let forward = [
            first.clone(),
            unknown.clone(),
            unknown.clone(),
            independent.clone(),
        ];
        let reverse = [unknown.clone(), unknown, first, independent];
        let out = project(confirmed(&thread, &forward, &cancelled)).unwrap();
        let reversed = project(confirmed(&thread, &reverse, &cancelled)).unwrap();
        for projected in [&out, &reversed] {
            assert_eq!(projected.objects.len(), 2);
            assert!(
                projected
                    .objects
                    .iter()
                    .all(|object| object.use_count.is_none())
            );
            assert_eq!(projected.objects[0].associated_use_count, Some(0));
            assert_eq!(projected.objects[1].associated_use_count, Some(1));
            assert_eq!(projected.coverage.target_gaps, 1);
            assert_eq!(projected.coverage.dispatch_gaps, usize::from(ambiguous));
            assert!(
                projected.records[..3]
                    .iter()
                    .all(|record| record.target_conflict)
            );
            assert_eq!(projected.objects[0].coverage.target_gaps, 1);
            assert_eq!(projected.objects[1].coverage.target_gaps, 1);
        }
        assert_eq!(out.coverage, reversed.coverage);
        for (object, reversed) in out.objects.iter().zip(&reversed.objects) {
            assert_eq!(object.key, reversed.key);
            assert_eq!(object.coverage, reversed.coverage);
            assert_eq!(object.associated_use_count, reversed.associated_use_count);
        }
    }
}

#[test]
fn native_multiple_skill_candidates_share_one_canonical_row_and_no_invented_dispatch() {
    let mut op = operation("native", "command").as_ref().clone();
    op.path = None;
    op.work=Some(serde_json::from_value(serde_json::json!({"formatVersion":crate::adapters::contract::WORK_OBSERVATION_VERSION,"stage":"terminal","data":{"kind":"command","cwd":"/synthetic","source":"agent","parsed_commands":[{"kind":"read","path":"a/SKILL.md"},{"kind":"read","path":"b/SKILL.md"},{"kind":"read","path":"a/./SKILL.md"}]},"gaps":[]})).unwrap());
    let operations = vec![Arc::new(op)];
    let owner = thread();
    let cancelled = AtomicBool::new(false);
    let out = project(confirmed(&owner, &operations, &cancelled)).unwrap();
    assert_eq!(out.records.len(), 1);
    assert_eq!(out.objects.len(), 2);
    assert_eq!(out.records[0].objects.len(), 2);
    assert!(!out.records[0].unbound_target);
    assert_eq!(out.records[0].object, None);
    assert!(out.unassigned_records.is_empty());
    assert_eq!(out.coverage.dispatch_gaps, 1);
    assert_eq!(out.coverage.target_gaps, 0);
    for object in out.objects {
        assert_eq!(object.records, vec![0]);
        assert_eq!(object.associated_use_count, Some(0));
        assert_eq!(object.coverage.dispatch_gaps, 1);
    }
}

#[test]
fn replay_missing_time_coverage_is_order_independent_without_erasing_all_time_count() {
    let first = operation("canonical-time", "skillRead");
    let mut unknown = first.as_ref().clone();
    unknown.timestamp = None;
    let unknown = Arc::new(unknown);
    let owner = thread();
    let cancelled = AtomicBool::new(false);
    for operations in [
        vec![first.clone(), unknown.clone()],
        vec![unknown.clone(), first.clone()],
    ] {
        let out = project(confirmed(&owner, &operations, &cancelled)).unwrap();
        assert_eq!(out.objects[0].associated_use_count, Some(1));
        assert_eq!(out.objects[0].coverage.time_gaps, 1);
        assert_eq!(out.coverage.time_gaps, 1);
    }
}
