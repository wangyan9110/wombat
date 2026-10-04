use super::*;

fn operation(id: &str, kind: &str) -> Operation {
    Operation {
        id: id.into(),
        thread_id: "thread".into(),
        turn_id: Some("turn".into()),
        item_id: None,
        call_id: Some(id.into()),
        response_id: None,
        kind: kind.into(),
        name: "read_file".into(),
        sequence: 1,
        timestamp: Some("2026-10-04T00:00:00Z".into()),
        time_precision: "second".into(),
        status: "completed".into(),
        exit_code: None,
        duration_ms: None,
        path: Some("/synthetic/skill/SKILL.md".into()),
        server: None,
        tool: None,
        evidence: vec![],
    }
}

#[test]
fn three_independent_reads_in_one_turn_count_three_uses_and_one_related_turn() {
    let mut projection = Projection::default();
    for id in ["read-1", "read-2", "read-3"] {
        projection.observe(&operation(id, "skillRead"));
    }
    assert_eq!(projection.count(false), Some(3));
    assert_eq!(projection.related_turns(), 1);
    assert_eq!(projection.related_tasks(), 1);
}

#[test]
fn canonical_start_result_and_explicit_fork_replays_count_once() {
    // Aliases and fork ancestry were reconciled by the adapter. The projection
    // receives the same canonical owner/ID, regardless of physical evidence.
    let mut start = operation("canonical", "skillRead");
    start.status = "running".into();
    let mut result = start.clone();
    result.status = "completed".into();
    let replay = result.clone();
    let mut projection = Projection::default();
    for record in [start, result, replay] {
        projection.observe(&record);
    }
    assert_eq!(projection.count(false), Some(1));
    assert_eq!(projection.related_turns(), 1);
}

#[test]
fn failure_cancellation_unknown_and_independent_retry_still_count() {
    let mut projection = Projection::default();
    for (id, status) in [
        ("call", "failed"),
        ("retry", "interrupted"),
        ("third", "unknown"),
    ] {
        let mut op = operation(id, "skillRead");
        op.status = status.into();
        projection.observe(&op);
    }
    assert_eq!(projection.count(false), Some(3));
}

#[test]
fn catalogs_declarations_discovery_and_conflicts_are_excluded() {
    for kind in [
        "skillAvailable",
        "skillCatalog",
        "skillUse",
        "mcpDiscovery",
        "mcpUnclassified",
        "mcpConflict",
        "command",
    ] {
        assert_eq!(use_kind(&operation("unused", kind)), None, "{kind}");
    }
    for (kind, expected) in [
        ("skillRead", UseKind::SkillRead),
        ("mcpTool", UseKind::McpTool),
        ("mcpResource", UseKind::McpResource),
    ] {
        assert_eq!(use_kind(&operation("used", kind)), Some(expected));
    }
    let mut read = operation("read", "tool");
    assert_eq!(use_kind(&read), Some(UseKind::SkillRead));
    read.path = Some("/synthetic/skill".into());
    assert_eq!(use_kind(&read), None);
    read.path = Some("/synthetic/skill/SKILL.md.backup".into());
    assert_eq!(use_kind(&read), None);
}

#[test]
fn one_operation_can_be_projected_once_for_each_explicit_target() {
    let op = operation("two-target-read", "skillRead");
    let mut first = Projection::default();
    let mut second = Projection::default();
    first.observe(&op);
    second.observe(&op);
    assert_eq!(
        (first.count(false), second.count(false)),
        (Some(1), Some(1))
    );
}

#[test]
fn same_native_identity_in_an_independent_task_is_not_a_fork_replay() {
    let mut first = operation("canonical", "skillRead");
    let mut second = first.clone();
    second.thread_id = "independent-thread".into();
    // A missing link establishes no synthetic related turn.
    first.turn_id = None;
    second.turn_id = None;
    let mut projection = Projection::default();
    projection.observe(&first);
    projection.observe(&second);
    assert_eq!(projection.count(false), Some(2));
    assert_eq!(projection.related_turns(), 0);
    assert_eq!(projection.related_tasks(), 2);
    assert_eq!(projection.coverage.turn_gaps, 2);
}

#[test]
fn anonymous_reads_preserve_count_gaps_instead_of_promoting_hashes() {
    let mut op = operation("physical-record-hash", "skillRead");
    op.call_id = None;
    let mut projection = Projection::default();
    projection.observe(&op);
    assert_eq!(projection.count(false), None);
    assert_eq!(projection.coverage.identity_gaps, 1);
    assert_eq!(projection.related_turns(), 1);
}

#[test]
fn wrapper_literals_are_candidates_without_dispatch_evidence() {
    let mut op = operation("physical-record-hash", "skillRead");
    op.call_id = None;
    op.name = "read_skill_file".into();
    assert!(is_skill_read_candidate(&op));
    assert_eq!(use_kind(&op), None);
    let mut projection = Projection::default();
    projection.coverage.dispatch_gaps += 1;
    assert_eq!(projection.count(false), None);
    assert_eq!(projection.related_turns(), 0);
}

#[test]
fn missing_times_only_block_date_windows_while_target_gaps_always_block_counts() {
    for timestamp in [None, Some("invalid".into())] {
        let mut op = operation("known-call", "skillRead");
        op.timestamp = timestamp;
        assert_eq!(time_basis(&op), TimeBasis::Unknown);
        let mut projection = Projection::default();
        projection.observe(&op);
        assert_eq!(projection.count(false), Some(1));
        assert_eq!(projection.count(true), None);
        assert_eq!(projection.coverage.time_gaps, 1);
    }
    let mut projection = Projection::default();
    projection.observe(&operation("known-call", "skillRead"));
    projection.coverage.target_gaps += 1;
    assert_eq!(projection.count(false), None);
}
