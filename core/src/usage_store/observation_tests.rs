use super::*;
use crate::session_events::{
    ActivityKind, Event, Payload, Position, Time, title_observations::TitleObservation,
};
fn data() -> Collected {
    let thread = Thread {
        id: "thread".into(),
        agent_kind: "codex".into(),
        source_instance_id: "source".into(),
        upstream_id: "native".into(),
        title: Some("safe title".into()),
        project: None,
        started_at: None,
        last_activity_at: None,
    };
    let event = Event::new_at(
        Position {
            source_instance_id: "source".into(),
            file_id: "file".into(),
            generation: "generation".into(),
            byte_offset: 0,
            ordinal: 0,
        },
        Some("thread".into()),
        None,
        Time::from_source(None).0,
        vec![],
        Payload::Activity {
            activity: ActivityKind::Assistant,
        },
        "2026-10-05T00:00:00Z".into(),
    )
    .unwrap();
    Collected {
        threads: vec![thread],
        events: vec![Arc::new(event)],
        title_observations: vec![TitleObservation {
            version: 1,
            source_instance_id: "source".into(),
            thread_id: "thread".into(),
            file_id: "title-index".into(),
            source_updated_at: "2026-10-04T00:00:00Z".into(),
            observed_at: "2026-10-05T00:00:00Z".into(),
            title: "safe title".into(),
        }],
        ..Default::default()
    }
}
#[test]
fn memory_and_fixed_views_keep_safe_observations() {
    let root = tempfile::tempdir().unwrap();
    let facts = data();
    let prices = crate::pricing_sync::current_at(root.path()).unwrap();
    let live = memory(facts.clone(), "live:observations".into(), prices, None).unwrap();
    let old = save_at(root.path(), facts.clone()).unwrap();
    let fixed = load_at(root.path(), Some(&old.manifest.snapshot_ref.snapshot_id)).unwrap();
    for snapshot in [&live, &old, &fixed] {
        let manifest = serde_json::to_value(&snapshot.manifest).unwrap();
        for &kind in crate::observation_versions::ObservationHeaderSet::Snapshot.kinds() {
            assert_eq!(manifest[kind.field()], serde_json::json!(kind.current()));
        }
        assert!(manifest.get("observationVersions").is_none());
        assert_eq!(
            snapshot
                .manifest
                .observation_versions
                .message_observation_version,
            crate::adapters::codex::incremental::MESSAGE_OBSERVATION_VERSION
        );
        assert_eq!(
            snapshot
                .manifest
                .observation_versions
                .operation_observation_version,
            crate::adapters::codex::incremental::OPERATION_OBSERVATION_VERSION
        );
        assert_eq!(
            snapshot
                .manifest
                .observation_versions
                .measurement_observation_version,
            crate::adapters::codex::incremental::MEASUREMENT_OBSERVATION_VERSION
        );
        assert_eq!(
            snapshot.manifest.title_observations,
            facts.title_observations
        );
        let events = snapshot.events().unwrap();
        assert_eq!(events[0].collected_at(), "2026-10-05T00:00:00Z");
        assert_eq!(events[0].time().timestamp, None);
    }
    assert_eq!(
        live.live_collected().unwrap().title_observations,
        facts.title_observations
    );
    let mut newer = facts;
    newer.threads[0].title = Some("new title".into());
    newer.title_observations[0].title = "new title".into();
    newer.title_observations[0].observed_at = "2026-10-06T00:00:00Z".into();
    save_at(root.path(), newer).unwrap();
    let retained = load_at(root.path(), Some(&old.manifest.snapshot_ref.snapshot_id)).unwrap();
    assert_eq!(retained.manifest.title_observations[0].title, "safe title");
}

#[test]
fn fixed_old_or_unknown_message_mapping_rejects_before_payload_and_preserves_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let snapshot = save_at(root.path(), data()).unwrap();
    let path = snapshot.directory.join("manifest.json");
    let original = fs::read(&path).unwrap();
    let latest = fs::read(root.path().join("latest.json")).unwrap();
    let events = fs::read(
        snapshot
            .directory
            .join(&snapshot.manifest.events.partitions[0].chunks[0].file.file),
    )
    .unwrap();
    for version in [None, Some(1), Some(99)] {
        let mut changed: serde_json::Value = serde_json::from_slice(&original).unwrap();
        changed
            .as_object_mut()
            .unwrap()
            .remove("messageObservationVersion");
        if let Some(version) = version {
            changed["messageObservationVersion"] = serde_json::json!(version);
        }
        // An unknown mapping must fail before decoding even an incompatible payload.
        changed["threads"] = serde_json::json!("future shape");
        fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            crate::live_index::failure_code(
                &load_at(
                    root.path(),
                    Some(&snapshot.manifest.snapshot_ref.snapshot_id)
                )
                .err()
                .unwrap()
            ),
            "UNSUPPORTED_VERSION"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read(root.path().join("latest.json")).unwrap(), latest);
        assert_eq!(
            fs::read(
                snapshot
                    .directory
                    .join(&snapshot.manifest.events.partitions[0].chunks[0].file.file)
            )
            .unwrap(),
            events
        );
    }
    fs::write(path, original).unwrap();
    assert!(
        load_at(
            root.path(),
            Some(&snapshot.manifest.snapshot_ref.snapshot_id)
        )
        .is_ok()
    );
}
#[test]
fn fixed_unknown_or_missing_observation_headers_reject_before_payload_and_preserve_files() {
    let root = tempfile::tempdir().unwrap();
    let snapshot = save_at(root.path(), data()).unwrap();
    let path = snapshot.directory.join("manifest.json");
    let original = fs::read(&path).unwrap();
    let base: serde_json::Value = serde_json::from_slice(&original).unwrap();
    let latest = fs::read(root.path().join("latest.json")).unwrap();
    let event_path = snapshot
        .directory
        .join(&snapshot.manifest.events.partitions[0].chunks[0].file.file);
    let event_bytes = fs::read(&event_path).unwrap();
    for field in [
        "operationObservationVersion",
        "operationAssociationVersion",
        "measurementObservationVersion",
        "eventObservationVersion",
        "titleObservationVersion",
        "titleObservations",
    ] {
        let mut changed = base.clone();
        changed.as_object_mut().unwrap().remove(field);
        fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
        let before = fs::read(&path).unwrap();
        let error = load_at(
            root.path(),
            Some(&snapshot.manifest.snapshot_ref.snapshot_id),
        )
        .err()
        .unwrap();
        assert_eq!(
            crate::live_index::failure_code(&error),
            "UNSUPPORTED_VERSION"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read(root.path().join("latest.json")).unwrap(), latest);
        assert_eq!(fs::read(&event_path).unwrap(), event_bytes);
    }
    for field in [
        "operationObservationVersion",
        "operationAssociationVersion",
        "measurementObservationVersion",
        "eventObservationVersion",
        "titleObservationVersion",
    ] {
        let mut changed = base.clone();
        changed[field] = serde_json::json!(99);
        changed["titleObservations"] = serde_json::json!({"future":"unsupported payload"});
        fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            crate::live_index::failure_code(
                &load_at(
                    root.path(),
                    Some(&snapshot.manifest.snapshot_ref.snapshot_id)
                )
                .err()
                .unwrap()
            ),
            "UNSUPPORTED_VERSION"
        );
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read(root.path().join("latest.json")).unwrap(), latest);
        assert_eq!(fs::read(&event_path).unwrap(), event_bytes);
    }
    fs::write(&path, original).unwrap();
    assert!(
        load_at(
            root.path(),
            Some(&snapshot.manifest.snapshot_ref.snapshot_id)
        )
        .is_ok()
    );
}
#[test]
fn scoped_title_validation_rejects_cross_source_duplicate_and_missing_targets_without_latest_change()
 {
    let root = tempfile::tempdir().unwrap();
    let old = save_at(root.path(), data()).unwrap();
    let latest = fs::read(root.path().join("latest.json")).unwrap();
    for variant in 0..4 {
        let mut facts = data();
        match variant {
            0 => facts.title_observations[0].source_instance_id = "other-source".into(),
            1 => facts.title_observations[0].thread_id = "missing".into(),
            2 => facts
                .title_observations
                .push(facts.title_observations[0].clone()),
            _ => facts.title_observations[0].title = "unsafe\nbody".into(),
        }
        assert!(save_at(root.path(), facts.clone()).is_err());
        assert!(
            memory(
                facts,
                "live:bad".into(),
                crate::pricing_sync::current_at(root.path()).unwrap(),
                None
            )
            .is_err()
        );
        assert_eq!(fs::read(root.path().join("latest.json")).unwrap(), latest);
    }
    let path = old.directory.join("manifest.json");
    let mut raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    raw["titleObservations"][0]["sourceInstanceId"] = serde_json::json!("forged-source");
    fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
    assert_eq!(
        crate::live_index::failure_code(
            &load_at(root.path(), Some(&old.manifest.snapshot_ref.snapshot_id))
                .err()
                .unwrap()
        ),
        "SNAPSHOT_CORRUPT"
    );
}
