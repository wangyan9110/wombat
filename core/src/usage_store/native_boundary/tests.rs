use super::*;
use crate::session_events::{LifecycleKind, Payload, Phase, Position, Time};
use serde_json::json;
fn boundary(offset: u64, phase: Phase, duration: Option<u64>, ttft: Option<u64>) -> Arc<Event> {
    Arc::new(
        Event::new(
            Position {
                source_instance_id: "source".into(),
                file_id: "file".into(),
                generation: "generation".into(),
                byte_offset: offset,
                ordinal: 0,
            },
            Some("thread".into()),
            Some("turn".into()),
            Time::from_source(Some("2026-10-04T00:00:00Z")).0,
            vec![],
            Payload::Lifecycle {
                lifecycle: LifecycleKind::Turn,
                phase,
                native_id: Some("turn".into()),
                duration_ms: duration,
                first_token_ms: ttft,
            },
        )
        .unwrap(),
    )
}
fn facts(events: Vec<Arc<Event>>) -> Collected {
    Collected {
        threads: vec![Thread {
            id: "thread".into(),
            agent_kind: "codex".into(),
            source_instance_id: "source".into(),
            upstream_id: "native".into(),
            title: None,
            project: None,
            started_at: None,
            last_activity_at: None,
        }],
        turns: vec![
            serde_json::from_value(
                json!({"id":"turn","threadId":"thread","upstreamId":"turn","ordinal":1,"status":"completed"}),
            )
            .unwrap(),
        ],
        events,
        ..Default::default()
    }
}
fn target() -> timing_evidence::TurnTarget<'static> {
    timing_evidence::TurnTarget {
        source: "source",
        thread: "thread",
        turn: "turn",
    }
}
fn code(error: anyhow::Error) -> &'static str {
    error
        .downcast_ref::<crate::dto::OperationError>()
        .unwrap()
        .code
}
fn pair(root: &Path, collected: Collected) -> (Snapshot, Snapshot) {
    (
        memory(
            collected.clone(),
            "live:scope:view".into(),
            crate::pricing_sync::current_at(root).unwrap(),
            None,
        )
        .unwrap(),
        save_at(root, collected).unwrap(),
    )
}
#[test]
fn native_index_agrees_across_read_modes_and_needs_no_event_or_ledger_files() {
    let root = tempfile::tempdir().unwrap();
    let (memory, disk) = pair(
        root.path(),
        facts(vec![
            boundary(0, Phase::Started, None, None),
            boundary(1, Phase::Completed, Some(0), Some(0)),
        ]),
    );
    let cancelled = AtomicBool::new(false);
    let expected = memory
        .timing_native_boundary(target(), &cancelled)
        .unwrap()
        .unwrap()
        .clone();
    assert_eq!(expected.native_wall_clock_ms, Some(0));
    assert_eq!(expected.native_ttft_ms, Some(0));
    assert_eq!(expected.state, crate::timing::analysis::State::Completed);
    for partition in &disk.manifest.events.partitions {
        for chunk in &partition.chunks {
            fs::remove_file(disk.directory.join(&chunk.file.file)).unwrap();
        }
    }
    fs::remove_file(disk.directory.join(&disk.manifest.ledger.file)).unwrap();
    assert_eq!(
        disk.timing_native_boundary(target(), &cancelled).unwrap(),
        Some(&expected)
    );
    // Metadata rejects an oversized whole target before touching the absent files.
    assert_eq!(
        code(
            disk.timing_evidence(
                target(),
                timing_evidence::TimingReadBudget {
                    max_facts: 1,
                    ..Default::default()
                },
                &cancelled
            )
            .err()
            .unwrap()
        ),
        "RESOURCE_LIMIT"
    );

    assert_eq!(
        disk.manifest.events.partitions[0]
            .native_boundary
            .event_count,
        2
    );
    assert!(disk.manifest.events.partitions[0].native_boundary.complete);
}
#[test]
fn complete_oversized_target_reduction_retains_native_scalars_and_late_conflicts() {
    let root = tempfile::tempdir().unwrap();
    let build = |conflict| {
        let mut events: Vec<_> = (0..MAX_TARGET_EVENTS)
            .map(|i| boundary(i as u64, Phase::Completed, Some(42), Some(5)))
            .collect();
        events.push(boundary(
            MAX_TARGET_EVENTS as u64,
            Phase::Completed,
            Some(if conflict { 43 } else { 42 }),
            Some(5),
        ));
        memory(
            facts(events),
            "live:scope:oversized".into(),
            crate::pricing_sync::current_at(root.path()).unwrap(),
            None,
        )
        .unwrap()
    };
    let cancelled = AtomicBool::new(false);
    let complete = build(false);
    assert_eq!(
        code(
            complete
                .events_for_target(
                    &EventTarget::turn("thread", "turn"),
                    EventReadBudget::default(),
                    &cancelled
                )
                .unwrap_err()
        ),
        "RESOURCE_LIMIT"
    );
    let summary = complete
        .timing_native_boundary(target(), &cancelled)
        .unwrap()
        .unwrap();
    assert_eq!(summary.candidates, MAX_TARGET_EVENTS + 1);
    assert_eq!(summary.native_wall_clock_ms, Some(42));
    assert_eq!(summary.native_ttft_ms, Some(5));
    drop(complete);
    let conflict = build(true);
    let summary = conflict
        .timing_native_boundary(target(), &cancelled)
        .unwrap()
        .unwrap();
    assert_eq!(summary.native_wall_clock_ms, None);
    assert!(summary.native_duration_conflict);
    assert_eq!(summary.native_ttft_ms, Some(5));
}
#[test]
fn native_summary_hash_required_shape_versions_and_completeness_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    let (_memory, disk) = pair(
        root.path(),
        facts(vec![boundary(0, Phase::Completed, Some(42), None)]),
    );
    let manifest_path = disk.directory.join("manifest.json");
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    let id = &disk.manifest.snapshot_ref.snapshot_id;
    for (field, value, expected) in [
        ("summary", json!({"unexpected":true}), "UNSUPPORTED_VERSION"),
        ("methodVersion", json!("future"), "UNSUPPORTED_VERSION"),
        ("complete", json!(false), "SNAPSHOT_CORRUPT"),
        ("eventCount", json!(2), "SNAPSHOT_CORRUPT"),
    ] {
        let mut raw = original.clone();
        raw["events"]["partitions"][0]["nativeBoundary"][field] = value;
        fs::write(&manifest_path, serde_json::to_vec(&raw).unwrap()).unwrap();
        assert_eq!(
            code(load_at(root.path(), Some(id)).err().unwrap()),
            expected
        );
    }
    let mut raw = original.clone();
    raw["events"]["partitions"][0]["nativeBoundary"]["summary"]["nativeWallClockMs"] = json!(43);
    fs::write(&manifest_path, serde_json::to_vec(&raw).unwrap()).unwrap();
    assert_eq!(
        code(load_at(root.path(), Some(id)).err().unwrap()),
        "SNAPSHOT_CORRUPT"
    );
    let mut raw = original.clone();
    raw["events"]["partitions"][0]
        .as_object_mut()
        .unwrap()
        .remove("nativeBoundary");
    fs::write(&manifest_path, serde_json::to_vec(&raw).unwrap()).unwrap();
    assert_eq!(
        code(load_at(root.path(), Some(id)).err().unwrap()),
        "UNSUPPORTED_VERSION"
    );
    fs::write(&manifest_path, serde_json::to_vec(&original).unwrap()).unwrap();
    assert!(load_at(root.path(), Some(id)).is_ok());
    assert!(manifest_path.exists());
}
#[test]
fn native_summary_rejects_identity_and_cancellation_without_guessing_missing_evidence() {
    let root = tempfile::tempdir().unwrap();
    let (memory, _disk) = pair(root.path(), facts(vec![]));
    let cancelled = AtomicBool::new(false);
    assert_eq!(
        memory.timing_native_boundary(target(), &cancelled).unwrap(),
        None
    );
    for (selected, expected) in [
        (
            timing_evidence::TurnTarget {
                source: "other",
                ..target()
            },
            "INVALID_ARGUMENT",
        ),
        (
            timing_evidence::TurnTarget {
                thread: "missing",
                ..target()
            },
            "NOT_FOUND",
        ),
        (
            timing_evidence::TurnTarget {
                turn: "missing",
                ..target()
            },
            "NOT_FOUND",
        ),
    ] {
        assert_eq!(
            code(
                memory
                    .timing_native_boundary(selected, &cancelled)
                    .err()
                    .unwrap()
            ),
            expected
        );
    }
    cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        code(
            memory
                .timing_native_boundary(target(), &cancelled)
                .err()
                .unwrap()
        ),
        "CANCELLED"
    );
}
