use super::*;

fn patch(id: &str, phase: &str, changes: Value, status: Option<&str>) -> Value {
    json!({"type":"event_msg","timestamp":"2026-10-05T01:00:00Z","payload":{"type":phase,"turn_id":"turn","item":{"type":"FileChange","id":id,"changes":changes,"status":status,"stdout":"PRIVATE_OUTPUT","stderr":"PRIVATE_ERROR"}}})
}
fn changes() -> Value {
    json!({"a.rs":{"type":"add","content":"PRIVATE_ADD"},"b.rs":{"type":"delete","content":"PRIVATE_DELETE"},"c.rs":{"type":"update","unified_diff":"PRIVATE_DIFF","move_path":"d.rs"}})
}
fn work(op: &Operation) -> &WorkObservation {
    op.work.as_ref().unwrap()
}
fn paths(op: &Operation) -> Option<&Vec<FilePathChange>> {
    match &work(op).data {
        WorkData::FileChange { changes } => changes.as_ref(),
        _ => panic!("file observation expected"),
    }
}

#[test]
fn file_maps_retain_safe_paths_and_moves_on_one_operation_without_bodies() {
    let root = tempfile::tempdir().unwrap();
    write(
        root.path(),
        "sessions/file.jsonl",
        &[
            meta("t"),
            patch(
                "p",
                "item_started",
                json!({"draft.rs":{"type":"add","content":"PRIVATE_DRAFT"}}),
                None,
            ),
            patch("p", "item_completed", changes(), Some("completed")),
            patch("p", "item_completed", changes(), Some("completed")),
        ],
    );
    let out = collect(root.path());
    assert_eq!(out.operations.len(), 1);
    let op = &out.operations[0];
    assert_eq!(work(op).stage, WorkStage::Terminal);
    assert_eq!(paths(op).unwrap().len(), 3);
    assert_eq!(
        paths(op).unwrap()[2],
        FilePathChange {
            path: "c.rs".into(),
            change: ChangeKind::Update,
            move_path: Some("d.rs".into())
        }
    );
    assert_eq!(op.status.as_ref(), "completed");
    assert!(!serde_json::to_string(&out).unwrap().contains("PRIVATE_"));
    assert!(
        !serde_json::to_string(&out.operations)
            .unwrap()
            .contains("draft.rs")
    );
    let observations = out
        .events
        .iter()
        .filter(|e| {
            matches!(
                e.payload(),
                crate::session_events::Payload::Operation { .. }
            )
        })
        .count();
    assert_eq!(
        observations, 3,
        "source observations survive canonical merging"
    );
}

#[test]
fn legacy_patch_end_failed_and_declined_keep_maps_but_transient_maps_do_not_count() {
    let root = tempfile::tempdir().unwrap();
    write(
        root.path(),
        "sessions/legacy.jsonl",
        &[
            meta("t"),
            context("turn", "model", "high"),
            json!({"type":"event_msg","payload":{"type":"patch_apply_begin","call_id":"not-durable","changes":changes()}}),
            json!({"type":"event_msg","payload":{"type":"patch_apply_updated","call_id":"not-durable","changes":changes()}}),
            json!({"type":"event_msg","payload":{"type":"patch_apply_end","call_id":"end","turn_id":"turn","success":false,"status":"failed","changes":changes(),"stdout":"PRIVATE_STDOUT"}}),
            patch("denied", "item_completed", changes(), Some("declined")),
        ],
    );
    let out = collect(root.path());
    assert_eq!(out.operations.len(), 2);
    assert_eq!(
        out.operations
            .iter()
            .map(|op| op.status.as_ref())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["failed", "declined"])
    );
    assert!(
        out.operations
            .iter()
            .all(|op| paths(op).unwrap().len() == 3 && work(op).stage == WorkStage::Terminal)
    );
    assert!(!serde_json::to_string(&out).unwrap().contains("PRIVATE_"));
}

#[test]
fn missing_empty_unknown_malformed_and_conflicting_maps_are_distinct() {
    let root = tempfile::tempdir().unwrap();
    let mut missing = patch("missing", "item_completed", Value::Null, Some("completed"));
    missing["payload"]["item"]
        .as_object_mut()
        .unwrap()
        .remove("changes");
    write(
        root.path(),
        "sessions/gaps.jsonl",
        &[
            meta("t"),
            missing,
            patch("empty", "item_completed", json!({}), Some("completed")),
            patch(
                "unknown",
                "item_completed",
                json!({"u.rs":{"type":"future","content":"PRIVATE_FUTURE"}}),
                Some("completed"),
            ),
            patch(
                "bad",
                "item_completed",
                json!({"a.rs":{"type":"update","move_path":42}}),
                Some("completed"),
            ),
            patch("conflict", "item_completed", changes(), Some("completed")),
            patch(
                "conflict",
                "item_completed",
                json!({"different.rs":{"type":"add"}}),
                Some("completed"),
            ),
            patch("conflict", "item_completed", changes(), Some("completed")),
        ],
    );
    let out = collect(root.path());
    let find = |id| {
        out.operations
            .iter()
            .find(|op| op.item_id.as_deref() == Some(id))
            .unwrap()
    };
    assert_eq!(work(find("missing")).gaps, [WorkGap::MissingChanges]);
    assert!(paths(find("missing")).is_none());
    assert_eq!(paths(find("empty")).unwrap().len(), 0);
    assert!(work(find("empty")).gaps.is_empty());
    assert_eq!(
        paths(find("unknown")).unwrap()[0].change,
        ChangeKind::Unknown
    );
    assert_eq!(work(find("unknown")).gaps, [WorkGap::UnknownVariant]);
    assert_eq!(work(find("bad")).gaps, [WorkGap::InvalidField]);
    assert!(paths(find("bad")).is_none());
    assert_eq!(
        work(find("conflict")).gaps,
        [WorkGap::ConflictingObservation]
    );
    assert!(paths(find("conflict")).is_none());
}

#[test]
fn bounded_map_and_duplicate_native_keys_never_publish_a_complete_prefix() {
    let root = tempfile::tempdir().unwrap();
    let many = (0..=WORK_PATH_LIMIT)
        .map(|n| (format!("{n}.rs"), json!({"type":"add"})))
        .collect::<serde_json::Map<_, _>>();
    let path = write(
        root.path(),
        "sessions/bounds.jsonl",
        &[
            meta("t"),
            patch(
                "huge",
                "item_completed",
                Value::Object(many),
                Some("completed"),
            ),
        ],
    );
    use std::io::Write;
    fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(br#"{"type":"event_msg","payload":{"type":"patch_apply_end","call_id":"duplicate","turn_id":"turn","status":"completed","changes":{"x.rs":{"type":"add"},"x.rs":{"type":"delete"}}}}
"#).unwrap();
    let out = collect(root.path());
    assert_eq!(out.operations.len(), 2);
    assert!(out.operations.iter().all(|op| paths(op).is_none()));
    assert!(
        out.operations
            .iter()
            .any(|op| work(op).gaps == [WorkGap::ResourceLimit])
    );
    assert!(
        out.operations
            .iter()
            .any(|op| work(op).gaps == [WorkGap::ConflictingObservation])
    );
}

#[test]
fn incremental_restart_append_and_explicit_fork_replay_preserve_work_once() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/a.jsonl",
        &[
            meta("parent"),
            patch("p", "item_completed", changes(), Some("completed")),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let run = || {
        let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
        let tx = db.transaction().unwrap();
        let out = incremental::sync(&tx, &source, false).unwrap();
        tx.commit().unwrap();
        out
    };
    let first = run().unwrap();
    let second = patch("q", "item_completed", json!({}), Some("failed")).to_string() + "\n";
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(second.as_bytes())
        .unwrap();
    let next = run().unwrap();
    assert_eq!(next.operations.len(), 2);
    assert!(next.operations.contains(&first.operations[0]));
    let mut fork = meta("child");
    fork["payload"]["forked_from_id"] = json!("parent");
    write(
        root.path(),
        "sessions/b.jsonl",
        &[
            fork,
            patch("p", "item_completed", changes(), Some("completed")),
        ],
    );
    let forked = run().unwrap();
    assert_eq!(forked.operations.len(), 2);
    assert_eq!(
        serde_json::to_value(&forked.operations).unwrap(),
        serde_json::to_value(&collect(root.path()).operations).unwrap()
    );
    let db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let saved: String = db
        .query_row("SELECT group_concat(json(payload)) FROM entries", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(!saved.contains("PRIVATE_"));
}
