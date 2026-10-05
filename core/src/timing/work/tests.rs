use super::*;
use crate::adapters::contract::{ChangeKind, FilePathChange, WorkGap, WorkObservation};
fn thread() -> Thread {
    serde_json::from_value(serde_json::json!({"id":"thread","sourceInstanceId":"source","agentKind":"codex","upstreamId":"native","project":"/guessed/project"})).unwrap()
}
fn operation(id: &str, kind: &str, status: &str) -> Arc<Operation> {
    Arc::new(serde_json::from_value(serde_json::json!({"id":id,"threadId":"thread","turnId":"turn","callId":id,"kind":kind,"name":"safe","sequence":1,"timePrecision":"unknown","status":status,"evidence":[]})).unwrap())
}
fn file(
    id: &str,
    status: &str,
    stage: WorkStage,
    paths: &[(&str, Option<&str>)],
) -> Arc<Operation> {
    let mut op = operation(id, "file", status).as_ref().clone();
    op.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage,
        data: WorkData::FileChange {
            changes: Some(
                paths
                    .iter()
                    .map(|(path, moved)| FilePathChange {
                        path: (*path).into(),
                        change: ChangeKind::Update,
                        move_path: moved.map(str::to_owned),
                    })
                    .collect(),
            ),
        },
        gaps: vec![],
    });
    Arc::new(op)
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
        budget: Budget::default(),
        cancelled,
    }
}
fn run(operations: &[Arc<Operation>]) -> Projection {
    project(input(&thread(), operations, &AtomicBool::new(false))).unwrap()
}
fn code(error: anyhow::Error) -> &'static str {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
}
#[test]
fn terminal_and_failed_counts_keep_retries_and_collapse_replay() {
    let first = operation("one", "command", "completed");
    let ops = [
        first.clone(),
        first,
        operation("two", "tool", "failed"),
        operation("three", "command", "cancelled"),
        operation("four", "tool", "interrupted"),
        operation("five", "file", "declined"),
        operation("six", "command", "running"),
    ];
    let out = run(&ops);
    assert_eq!(out.method_version, METHOD_VERSION);
    assert_eq!(out.operation_candidates.value, Some(6));
    assert_eq!(out.closed_operations.value, Some(5));
    assert_eq!(out.failed_operations.value, Some(1));
    assert_eq!(out.file_change_records.value, Some(1));
    assert_eq!(out.changed_files.value, None);
    assert_eq!(out.coverage.replay_records, 1);
    assert_eq!(out.coverage.time_gaps, 7);
}
#[test]
fn failed_and_declined_terminal_maps_report_paths_and_move_endpoints() {
    let ops = [
        file(
            "failed",
            "failed",
            WorkStage::Terminal,
            &[("/synthetic/dir/../a", Some("/synthetic/b"))],
        ),
        file(
            "declined",
            "declined",
            WorkStage::Terminal,
            &[("/synthetic/a", None)],
        ),
    ];
    let out = run(&ops);
    assert_eq!(out.file_change_records.value, Some(2));
    assert_eq!(out.changed_files.value, Some(2));
    assert_eq!(out.changed_files.basis, Basis::ReportedPathUnion);
    assert_eq!(out.failed_operations.value, Some(1));
}
#[test]
fn explicit_empty_terminal_map_is_zero_but_proposed_is_unknown() {
    let empty = file("empty", "completed", WorkStage::Terminal, &[]);
    assert_eq!(
        run(std::slice::from_ref(&empty)).changed_files.value,
        Some(0)
    );
    let proposed = file(
        "pending",
        "running",
        WorkStage::Proposed,
        &[("/synthetic/a", None)],
    );
    let out = run(&[empty, proposed]);
    assert_eq!(out.file_change_records.value, Some(2));
    assert_eq!(out.changed_files.value, None);
    assert_eq!(out.changed_files.gaps, vec![Gap::NonTerminalFile]);
    assert_eq!(out.closed_operations.value, Some(1));
}
#[test]
fn relative_paths_cannot_use_thread_project_as_historical_cwd() {
    let out = run(&[file(
        "relative",
        "completed",
        WorkStage::Terminal,
        &[("a", None)],
    )]);
    assert_eq!(out.changed_files.value, None);
    assert_eq!(out.changed_files.gaps, vec![Gap::MissingPathScope]);
    assert_eq!(out.coverage.path_scope_gaps, 1);
}
#[test]
fn missing_file_metadata_and_native_gaps_never_become_zero() {
    let mut op = file(
        "gap",
        "failed",
        WorkStage::Terminal,
        &[("/synthetic/a", None)],
    )
    .as_ref()
    .clone();
    op.work.as_mut().unwrap().gaps.push(WorkGap::UnknownVariant);
    let out = run(&[Arc::new(op), operation("old", "file", "completed")]);
    assert_eq!(out.file_change_records.value, Some(2));
    assert_eq!(out.changed_files.value, None);
    assert!(out.changed_files.gaps.contains(&Gap::UnknownOperationKind));
    assert!(out.changed_files.gaps.contains(&Gap::MissingWorkMetadata));
}
#[test]
fn missing_native_identity_invalidates_only_related_file_counts() {
    let mut op = operation("physical", "command", "completed")
        .as_ref()
        .clone();
    op.call_id = None;
    let out = run(&[Arc::new(op)]);
    assert_eq!(out.operation_candidates.value, None);
    assert_eq!(out.file_change_records.value, Some(0));
    assert_eq!(out.changed_files.value, Some(0));
    assert_eq!(out.coverage.identity_gaps, 1);
}
#[test]
fn canonical_conflicts_do_not_poison_unrelated_file_family() {
    let out = run(&[
        operation("same", "command", "running"),
        operation("same", "command", "completed"),
    ]);
    assert_eq!(out.operation_candidates.value, None);
    assert_eq!(out.closed_operations.value, None);
    assert_eq!(out.file_change_records.value, Some(0));
    let out = run(&[
        operation("same", "command", "completed"),
        operation("same", "file", "completed"),
    ]);
    assert_eq!(out.file_change_records.value, None);
    assert_eq!(out.coverage.canonical_conflicts, 1);
}
#[test]
fn unknown_outcome_does_not_invent_closed_from_nonzero_exit() {
    let mut op = operation("code", "command", "unknown").as_ref().clone();
    op.exit_code = Some(7);
    let out = run(&[Arc::new(op)]);
    assert_eq!(out.operation_candidates.value, Some(1));
    assert_eq!(out.closed_operations.value, None);
    assert_eq!(out.failed_operations.value, Some(1));
    assert_eq!(out.coverage.unknown_outcomes, 1);
}
#[test]
fn declarations_and_wrapper_candidates_are_not_operation_candidates() {
    let mut candidate = operation("wrapper", "skillRead", "completed")
        .as_ref()
        .clone();
    candidate.name = "read_skill_file".into();
    let out = run(&[
        Arc::new(candidate),
        operation("catalog", "skillCatalog", "completed"),
        operation("declaration", "skillUse", "completed"),
        operation("compact", "compaction", "completed"),
    ]);
    assert_eq!(out.operation_candidates.value, Some(0));
    assert_eq!(out.coverage.excluded_records, 4);
}
#[test]
fn partial_source_retains_observed_counts_with_incomplete_coverage() {
    let source = SourceReport {
        source: crate::adapters::contract::SourceInstance {
            id: "source".into(),
            agent_kind: "codex".into(),
            root: "/synthetic".into(),
        },
        adapter_version: "synthetic".into(),
        source_versions: vec![],
        capabilities: Default::default(),
        status: "partial".into(),
        files_read: 1,
        bytes_read: 1,
        issues: vec![],
    };
    let t = thread();
    let ops = [operation("native", "command", "completed")];
    let cancelled = AtomicBool::new(false);
    let out = project(Input {
        source: Some(&source),
        ..input(&t, &ops, &cancelled)
    })
    .unwrap();
    assert_eq!(out.coverage.source, SourceCoverage::Partial);
    assert_eq!(out.operation_candidates.value, Some(1));
    assert_eq!(out.coverage.time_gaps, 1);
}
#[test]
fn cancellation_budgets_and_target_mismatch_return_errors_not_prefixes() {
    let t = thread();
    let ops = [operation("native", "command", "completed")];
    let cancelled = AtomicBool::new(true);
    assert_eq!(
        code(project(input(&t, &ops, &cancelled)).unwrap_err()),
        "CANCELLED"
    );
    cancelled.store(false, Ordering::Relaxed);
    for budget in [
        Budget {
            operations: 0,
            ..Budget::default()
        },
        Budget {
            metadata: 0,
            ..Budget::default()
        },
        Budget {
            string_bytes: 0,
            ..Budget::default()
        },
    ] {
        assert_eq!(
            code(
                project(Input {
                    budget,
                    ..input(&t, &ops, &cancelled)
                })
                .unwrap_err()
            ),
            "RESOURCE_LIMIT"
        );
    }
    assert_eq!(
        code(
            project(Input {
                turn: "another",
                ..input(&t, &ops, &cancelled)
            })
            .unwrap_err()
        ),
        "INVALID_ARGUMENT"
    );
}
#[test]
fn unknown_kind_and_unknown_metadata_version_are_explicit() {
    let out = run(&[operation("future", "future_operation", "completed")]);
    assert_eq!(out.file_change_records.value, None);
    assert_eq!(
        out.operation_candidates.gaps,
        vec![Gap::UnknownOperationKind]
    );
    let mut op = file("future", "completed", WorkStage::Terminal, &[])
        .as_ref()
        .clone();
    op.work.as_mut().unwrap().format_version += 1;
    assert_eq!(
        code(project(input(&thread(), &[Arc::new(op)], &AtomicBool::new(false))).unwrap_err()),
        "UNSUPPORTED_VERSION"
    );
}

#[test]
fn native_command_read_candidates_remain_one_dispatched_work_operation() {
    use crate::adapters::contract::{CommandSource, ParsedCommand};
    let mut op = operation("native", "command", "failed").as_ref().clone();
    op.work = Some(WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: WorkStage::Terminal,
        data: WorkData::Command {
            cwd: Some("file:///synthetic".into()),
            source: Some(CommandSource::Agent),
            parsed_commands: Some(vec![
                ParsedCommand::Read {
                    path: Some("/synthetic/one/SKILL.md".into()),
                },
                ParsedCommand::Read {
                    path: Some("/synthetic/two/SKILL.md".into()),
                },
            ]),
        },
        gaps: vec![],
    });
    assert!(usage_observations::is_skill_read_candidate(&op));
    let out = run(&[Arc::new(op)]);
    assert_eq!(out.operation_candidates.value, Some(1));
    assert_eq!(out.closed_operations.value, Some(1));
    assert_eq!(out.failed_operations.value, Some(1));
    assert_eq!(out.file_change_records.value, Some(0));
}
