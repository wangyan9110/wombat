//! Independent canonical-operation fixtures; no adapter parsing or service execution.
use super::follow_up::observe;
use crate::{
    adapters::contract::{Collected, Operation, Thread},
    config::View,
    config_dto::{Item, Kind},
    optimize_dto::{Category, FollowUpStatus, Suggestion},
    usage_observations::Projection,
};
use std::sync::Arc;

const AFTER: &str = "2026-10-01T00:00:00Z";
const AT: &str = "2026-10-01T01:00:00Z";
const CUTOFF: &str = "2026-10-02T00:00:00Z";

fn item(id: &str, kind: Kind) -> Item {
    let kind_name = match kind {
        Kind::Skill => "skill",
        Kind::Rule => "rule",
        Kind::Mcp => "mcp",
        Kind::Hook => "hook",
    };
    serde_json::from_value(serde_json::json!({
        "id": id, "name": id, "kind": kind_name, "sourceInstanceId": "source",
        "path": if kind == Kind::Rule { "/synthetic/AGENTS.md" } else { "/synthetic/SKILL.md" },
        "authorizedProjects": [], "sourceContexts": [], "nativeKey": "server",
        "configuredState": "enabled", "contentHash": "synthetic", "observedAt": AFTER,
        "current": true, "stale": false, "estimateStatus": "unknown",
        "measurementStatus": "unknown", "bodyEstimateStatus": "unknown",
        "observation": "unknown", "counts": {"fileReads": 0, "toolCalls": 0,
        "resourceReads": 0, "succeeded": 0, "failed": 0, "outcomeUnknown": 0},
        "relatedTurns": 0, "relatedTasks": 0
    }))
    .unwrap()
}
fn operation(id: &str, kind: &str, object: &Item) -> Operation {
    serde_json::from_value(serde_json::json!({
        "id": id, "threadId": "thread", "turnId": "turn", "callId": id,
        "kind": kind, "name": "read_file", "sequence": 1, "timestamp": AT,
        "timePrecision": "second", "status": "completed", "path": object.path,
        "server": object.native_key, "evidence": []
    }))
    .unwrap()
}
fn thread(id: &str, source: &str, project: Option<&str>) -> Thread {
    Thread {
        id: id.into(),
        agent_kind: "codex".into(),
        source_instance_id: source.into(),
        upstream_id: id.into(),
        title: None,
        project: project.map(str::to_owned),
        started_at: None,
        last_activity_at: None,
    }
}
fn view(items: Vec<Item>, operations: Vec<Operation>, threads: Vec<Thread>) -> View {
    let temp = tempfile::tempdir().unwrap();
    let snapshot = crate::usage_store::memory(
        Collected {
            operations: operations.into_iter().map(Arc::new).collect(),
            threads,
            ..Default::default()
        },
        "live:independent:follow-up".into(),
        crate::pricing_sync::current_at(temp.path()).unwrap(),
        None,
    )
    .unwrap();
    View {
        snapshot: Some(Arc::new(snapshot)),
        items,
        issues: vec![],
        projects: vec![],
        roots: vec![],
        project_roots: vec![],
        revision: "synthetic".into(),
        checked: CUTOFF.into(),
        history_status: "fixed".into(),
        analysis: Default::default(),
        hook_registry: Default::default(),
        observation_versions: Default::default(),
        config_collection: Default::default(),
    }
}
fn single(object: &Item, operations: Vec<Operation>) -> View {
    view(
        vec![object.clone()],
        operations,
        vec![thread("thread", "source", Some("/project"))],
    )
}
fn suggestion(object: &Item) -> Suggestion {
    Suggestion {
        scope_project: None,
        id: "suggestion".into(),
        item: object.clone(),
        category: Category::Repair,
        status: "verified".into(),
        decision: None,
        checks: vec![],
        findings: vec![],
        checked_at: AFTER.into(),
        rule_version: "synthetic".into(),
        rule_parameters: None,
        recheck_rule_parameters: None,
        review_baseline: None,
        record_id: Some("record".into()),
        recorded_at: None,
        record_kind: None,
    }
}
fn assert_unknown(object: &Item, operations: Vec<Operation>) {
    let out = observe(&[suggestion(object)], &single(object, operations), None);
    assert_eq!(out[0].status, FollowUpStatus::Unavailable);
    assert_eq!(out[0].observed_records, None);
    assert!(!out[0].absence_observable);
}

#[test]
fn known_dispatches_retries_and_canonical_replays_share_projection_count() {
    let object = item("skill", Kind::Skill);
    let mut first = operation("canonical", "skillRead", &object);
    first.status = "running".into();
    let mut result = first.clone();
    result.status = "failed".into();
    let mut retry = operation("retry", "skillRead", &object);
    retry.status = "interrupted".into();
    let mut third = operation("third", "tool", &object);
    third.status = "unknown".into();
    let mut operations = vec![first, result.clone(), result, retry, third];
    for kind in ["skillCatalog", "skillAvailable", "skillUse", "mcpDiscovery"] {
        operations.push(operation(kind, kind, &object));
    }
    let mut projection = Projection::default();
    for operation in &operations {
        if crate::usage_observations::use_kind(operation).is_some() {
            projection.observe(operation);
        }
    }
    let out = observe(&[suggestion(&object)], &single(&object, operations), None);
    assert_eq!(projection.count(true), Some(3));
    assert_eq!(out[0].observed_records, projection.count(true));
    assert_eq!(out[0].status, FollowUpStatus::VersionUnknown);
    assert_eq!(
        out[0].last_record_at.as_deref(),
        Some("2026-10-01T01:00:00+00:00")
    );
    assert_eq!(out[0].observed_at, CUTOFF);
    assert!(!out[0].absence_observable);
}

#[test]
fn candidates_and_anonymous_actual_reads_keep_count_unknown() {
    let object = item("skill", Kind::Skill);
    let known = operation("known", "skillRead", &object);
    let mut candidate = operation("wrapper", "skillRead", &object);
    candidate.name = "read_skill_file".into();
    assert_unknown(&object, vec![candidate.clone()]);
    assert_unknown(&object, vec![known.clone(), candidate]);
    let mut anonymous = operation("hash", "skillRead", &object);
    anonymous.call_id = None;
    let out = observe(
        &[suggestion(&object)],
        &single(&object, vec![known, anonymous]),
        None,
    );
    assert_eq!(out[0].status, FollowUpStatus::Unavailable);
    assert_eq!(out[0].observed_records, None);
    // This is a known observation time, not proof of a complete count/content version.
    assert!(out[0].last_record_at.is_some());
}

#[test]
fn missing_and_invalid_times_are_not_assigned_to_follow_up_window() {
    for kind in [Kind::Skill, Kind::Rule] {
        let object = item("object", kind.clone());
        let op_kind = if kind == Kind::Skill {
            "skillRead"
        } else {
            "tool"
        };
        for timestamp in [None, Some("invalid".into())] {
            let known = operation("known", op_kind, &object);
            let mut undated = operation("undated", op_kind, &object);
            undated.timestamp = timestamp;
            assert_unknown(&object, vec![known, undated]);
        }
    }
}

#[test]
fn fixed_cutoff_is_inclusive_after_is_exclusive_and_offsets_are_exact() {
    let object = item("skill", Kind::Skill);
    let operations = [
        ("boundary", "2026-10-01T08:00:00+08:00"),
        ("fraction", "2026-10-01T00:00:00.000001Z"),
        ("upper", "2026-10-02T08:00:00+08:00"),
        ("future", "2026-10-02T00:00:00.000001Z"),
    ]
    .into_iter()
    .map(|(id, at)| {
        let mut op = operation(id, "skillRead", &object);
        op.timestamp = Some(at.into());
        op
    })
    .collect();
    let mut view = single(&object, operations);
    let s = suggestion(&object);
    let out = observe(std::slice::from_ref(&s), &view, None);
    assert_eq!(out[0].observed_records, Some(2));
    assert_eq!(
        out[0].last_record_at.as_deref(),
        Some("2026-10-02T00:00:00+00:00")
    );
    assert_eq!(
        observe(std::slice::from_ref(&s), &view, None)[0].observed_records,
        Some(2)
    );
    let mut after = s.clone();
    after.checked_at = CUTOFF.into();
    assert_eq!(
        observe(&[after], &view, None)[0].status,
        FollowUpStatus::NoObservedRecords
    );
    for invalid in ["invalid", "2026-10-03T00:00:00Z"] {
        let mut bad = s.clone();
        bad.checked_at = invalid.into();
        assert_eq!(
            observe(&[bad], &view, None)[0].status,
            FollowUpStatus::Unavailable
        );
    }
    view.checked = "invalid".into();
    assert_eq!(
        observe(&[s], &view, None)[0].status,
        FollowUpStatus::Unavailable
    );
}

#[test]
fn rule_reads_are_independent_semantics_with_shared_reliable_identity() {
    let object = item("rule", Kind::Rule);
    let read = operation("read", "tool", &object);
    let retry = operation("retry", "tool", &object);
    let declaration = operation("declared", "instructionLoad", &object);
    let out = observe(
        &[suggestion(&object)],
        &single(&object, vec![read.clone(), read, retry, declaration]),
        None,
    );
    assert_eq!(out[0].observed_records, Some(2));
    let mut anonymous = operation("hash", "tool", &object);
    anonymous.call_id = None;
    assert_unknown(&object, vec![anonymous]);
    let skill = item("skill", Kind::Skill);
    let mut native = operation("native", "skillRead", &skill);
    native.name = "native_load".into();
    assert_eq!(
        observe(&[suggestion(&skill)], &single(&skill, vec![native]), None)[0].observed_records,
        Some(1)
    );
}

#[test]
fn generic_unknown_read_does_not_pollute_skill_but_explicit_skill_read_does() {
    let skill = item("skill", Kind::Skill);
    let rule = item("rule", Kind::Rule);
    let mut unknown = operation("generic", "tool", &skill);
    unknown.path = None;
    let known = operation("known", "skillRead", &skill);
    let suggestions = [suggestion(&skill), suggestion(&rule)];
    let v = view(
        vec![skill.clone(), rule],
        vec![known.clone(), unknown.clone()],
        vec![thread("thread", "source", Some("/project"))],
    );
    let out = observe(&suggestions, &v, None);
    assert_eq!(out[0].observed_records, Some(1));
    assert_eq!(out[1].status, FollowUpStatus::Unavailable);
    unknown.kind = "skillRead".into();
    assert_unknown(&skill, vec![known.clone(), unknown.clone()]);
    unknown.name = "read_skill_file".into();
    assert_unknown(&skill, vec![known, unknown]);
}

#[test]
fn source_and_project_filters_do_not_import_unrelated_gaps() {
    let object = item("skill", Kind::Skill);
    let known = operation("known", "skillRead", &object);
    let mut other_project = operation("project-gap", "skillRead", &object);
    other_project.thread_id = "other-project".into();
    other_project.path = None;
    let mut other_source = operation("source-gap", "skillRead", &object);
    other_source.thread_id = "other-source".into();
    other_source.path = None;
    let v = view(
        vec![object.clone()],
        vec![known, other_project, other_source],
        vec![
            thread("thread", "source", Some("/project")),
            thread("other-project", "source", Some("/other")),
            thread("other-source", "other", Some("/project")),
        ],
    );
    let mut s = suggestion(&object);
    s.scope_project = Some("/project".into());
    assert_eq!(
        observe(&[s.clone()], &v, Some("source"))[0].observed_records,
        Some(1)
    );
    assert_eq!(
        observe(&[s.clone()], &v, Some("other"))[0].status,
        FollowUpStatus::NoObservedRecords
    );
    s.scope_project = None;
    assert_eq!(
        observe(&[s], &v, None)[0].status,
        FollowUpStatus::Unavailable
    );
}

#[test]
fn mcp_ownership_outside_page_is_project_bound_and_cutoffs_do_not_create_owners() {
    let global = item("global", Kind::Mcp);
    let mut local = item("local", Kind::Mcp);
    local.project = Some("/project".into());
    let a = operation("a", "mcpTool", &global);
    let mut b = operation("b", "mcpResource", &global);
    b.thread_id = "b".into();
    b.status = "failed".into();
    let v = view(
        vec![global.clone(), local],
        vec![a, b],
        vec![
            thread("thread", "source", Some("/project")),
            thread("b", "source", Some("/other")),
        ],
    );
    let mut s = suggestion(&global);
    assert_eq!(
        observe(&[s.clone()], &v, None)[0].status,
        FollowUpStatus::Unavailable
    );
    s.scope_project = Some("/project".into());
    assert_eq!(
        observe(&[s.clone()], &v, None)[0].status,
        FollowUpStatus::Unavailable
    );
    s.scope_project = Some("/other".into());
    let mut earlier = s.clone();
    earlier.record_id = Some("earlier".into());
    earlier.checked_at = "2026-09-30T00:00:00Z".into();
    let out = observe(&[s, earlier], &v, None);
    assert!(out.iter().all(|o| o.observed_records == Some(1)));
}

#[test]
fn mcp_catalogs_are_excluded_but_unresolved_targets_remain_unknown() {
    let object = item("mcp", Kind::Mcp);
    let mut discovery = operation("catalog", "mcpDiscovery", &object);
    discovery.server = None;
    let actual = operation("actual", "mcpTool", &object);
    assert_eq!(
        observe(
            &[suggestion(&object)],
            &single(&object, vec![actual.clone(), discovery]),
            None
        )[0]
        .observed_records,
        Some(1)
    );
    for kind in ["mcpTool", "mcpResource", "mcpUnclassified", "mcpConflict"] {
        let mut unknown = operation("gap", kind, &object);
        unknown.server = None;
        assert_unknown(&object, vec![actual.clone(), unknown]);
    }
}

#[test]
fn unavailable_bases_and_unverified_records_never_claim_absence() {
    let object = item("skill", Kind::Skill);
    let mut v = single(&object, vec![operation("actual", "skillRead", &object)]);
    let mut s = suggestion(&object);
    s.status = "pending".into();
    assert!(observe(&[s.clone()], &v, None).is_empty());
    s.status = "verified".into();
    s.record_id = None;
    assert!(observe(&[s.clone()], &v, None).is_empty());
    s.record_id = Some("record".into());
    v.history_status = "unavailable".into();
    assert_eq!(
        observe(&[s.clone()], &v, None)[0].status,
        FollowUpStatus::Unavailable
    );
    v.history_status = "fixed".into();
    v.items[0].stale = true;
    assert_eq!(
        observe(&[s.clone()], &v, None)[0].status,
        FollowUpStatus::Unavailable
    );
    v.items[0].stale = false;
    v.snapshot = None;
    let out = observe(&[s], &v, None);
    assert_eq!(out[0].status, FollowUpStatus::Unavailable);
    assert_eq!(out[0].observed_records, None);
    assert!(!out[0].absence_observable);
}
