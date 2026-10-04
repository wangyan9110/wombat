use super::*;
fn source(root: &std::path::Path, id: &str) -> PathBuf {
    fs::create_dir_all(root.join("sessions")).unwrap();
    let path = root.join("sessions/fixture.jsonl");
    fs::write(&path, serde_json::json!({"type":"session_meta","timestamp":"2026-10-05T00:00:00Z","payload":{"id":id}}).to_string() + "\n").unwrap();
    path
}
fn invalidate_parser(db: &rusqlite::Connection, source_id: &str) {
    let scope = format!("parser:{source_id}:{}:1", adapters::codex::VERSION);
    let mut metadata = crate::live_index::load_map(db, &scope).unwrap();
    // A current-format identity failure is an ordinary per-source failure;
    // unsupported mapping formats must instead propagate out of the transaction.
    let checkpoint = metadata["checkpoints"]
        .as_object_mut()
        .unwrap()
        .values_mut()
        .next()
        .unwrap();
    checkpoint["watermark"]["fileId"] = json!("mismatched-file");
    crate::live_index::save_map(db, &scope, &metadata).unwrap();
}
#[test]
fn all_failed_sync_keeps_view_and_watermarks_immutable() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    source(root.path(), "all_failed");
    let roots = vec![root.path().to_string_lossy().into_owned()];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let initial = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    invalidate_parser(&db, &initial.manifest.sources[0].source.id);
    let saved = crate::live_index::load_map(&db, &format!("view:{key}")).unwrap();
    assert!(sync(&mut db, &key, &roots, false, Some(&initial), &mut caches).is_err());
    assert_eq!(
        crate::live_index::load_map(&db, &format!("view:{key}")).unwrap(),
        saved
    );
    let restored = restore(&db, &key, &roots).unwrap().unwrap();
    assert_eq!(restored.manifest.watermarks, initial.manifest.watermarks);
    assert_eq!(
        serde_json::to_value(&restored.manifest.snapshot_ref).unwrap(),
        serde_json::to_value(&initial.manifest.snapshot_ref).unwrap()
    );
}
#[test]
fn mixed_failure_observations_belong_to_new_view_and_survive_restore() {
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    source(root_a.path(), "a");
    let path_b = source(root_b.path(), "b");
    let roots = vec![
        root_a.path().to_string_lossy().into_owned(),
        root_b.path().to_string_lossy().into_owned(),
    ];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let initial = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    let source_a = sources(&roots).sources[0].id.clone();
    invalidate_parser(&db, &source_a);
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(path_b)
        .unwrap()
        .write_all(b"\n")
        .unwrap();
    let next = sync(&mut db, &key, &roots, false, Some(&initial), &mut caches)
        .unwrap()
        .unwrap();
    let old = initial
        .manifest
        .watermarks
        .iter()
        .find(|w| w.source_instance_id == source_a)
        .unwrap();
    let failed = next
        .manifest
        .watermarks
        .iter()
        .find(|w| w.source_instance_id == source_a)
        .unwrap();
    assert_eq!(failed.committed_offset, old.committed_offset);
    assert_eq!(failed.generation, old.generation);
    assert_eq!(failed.observed_bytes, None);
    assert_eq!(failed.state, WatermarkState::Failed);
    assert_eq!(old.state, WatermarkState::Complete);
    assert_ne!(
        initial.manifest.snapshot_ref.snapshot_id,
        next.manifest.snapshot_ref.snapshot_id
    );
    let restored = restore(&db, &key, &roots).unwrap().unwrap();
    assert_eq!(restored.manifest.watermarks, next.manifest.watermarks);
    assert_eq!(
        serde_json::to_value(&restored.manifest.snapshot_ref).unwrap(),
        serde_json::to_value(&next.manifest.snapshot_ref).unwrap()
    );
}

#[test]
fn missing_or_future_projection_mapping_refuses_restore_and_cached_sync_without_mutation() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    source(root.path(), "mapping");
    let roots = vec![root.path().to_string_lossy().into_owned()];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let initial = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    let source_id = &initial.manifest.sources[0].source.id;
    let scope = format!("projection:{source_id}");
    let original = crate::live_index::load_map(&db, &scope).unwrap();
    assert_eq!(
        original["messageObservationVersion"],
        json!(adapters::codex::incremental::MESSAGE_OBSERVATION_VERSION)
    );
    let saved_view = crate::live_index::load_map(&db, &format!("view:{key}")).unwrap();
    let parser_scope = format!("parser:{source_id}:{}:1", adapters::codex::VERSION);
    let saved_parser = crate::live_index::load_map(&db, &parser_scope).unwrap();
    for header in [None, Some(json!(2))] {
        let mut old = original.clone();
        old.remove("messageObservationVersion");
        if let Some(header) = header {
            old.insert("messageObservationVersion".into(), header);
        }
        crate::live_index::save_map(&db, &scope, &old).unwrap();
        // This also rejects before parsing facts, including hypothetical future rows.
        let mut future = old.clone();
        future.insert("futureMessageField".into(), json!({"unexpected":true}));
        crate::live_index::save_map(&db, &scope, &future).unwrap();
        let error = load_collected(&db, source_id).err().unwrap();
        assert_eq!(
            crate::live_index::failure_code(&error),
            "UNSUPPORTED_VERSION"
        );
        let error = restore(&db, &key, &roots).err().unwrap();
        assert_eq!(
            crate::live_index::failure_code(&error),
            "UNSUPPORTED_VERSION"
        );
        let error = sync(&mut db, &key, &roots, false, Some(&initial), &mut caches)
            .err()
            .unwrap();
        assert_eq!(
            crate::live_index::failure_code(&error),
            "UNSUPPORTED_VERSION"
        );
        assert_eq!(crate::live_index::load_map(&db, &scope).unwrap(), future);
        assert_eq!(
            crate::live_index::load_map(&db, &parser_scope).unwrap(),
            saved_parser
        );
        assert_eq!(
            crate::live_index::load_map(&db, &format!("view:{key}")).unwrap(),
            saved_view
        );
    }
}

#[test]
fn unsupported_parser_mapping_propagates_despite_current_projection_and_mixed_sources() {
    use std::io::Write;
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path_a = source(root_a.path(), "a");
    source(root_b.path(), "b");
    let roots = vec![
        root_a.path().to_string_lossy().into_owned(),
        root_b.path().to_string_lossy().into_owned(),
    ];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let initial = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    let ids: Vec<_> = sources(&roots).sources.into_iter().map(|s| s.id).collect();
    let saved_view = crate::live_index::load_map(&db, &format!("view:{key}")).unwrap();
    let saved_projection: Vec<_> = ids
        .iter()
        .map(|id| crate::live_index::load_map(&db, &format!("projection:{id}")).unwrap())
        .collect();
    let good_parser_scope = format!("parser:{}:{}:1", ids[0], adapters::codex::VERSION);
    let saved_good_parser = crate::live_index::load_map(&db, &good_parser_scope).unwrap();
    let scope = format!("parser:{}:{}:1", ids[1], adapters::codex::VERSION);
    let original = crate::live_index::load_map(&db, &scope).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(path_a)
        .unwrap()
        .write_all(b"\n")
        .unwrap();
    for header in [None, Some(json!(2))] {
        let mut old = original.clone();
        old.remove("messageObservationVersion");
        if let Some(header) = header {
            old.insert("messageObservationVersion".into(), header);
        }
        crate::live_index::save_map(&db, &scope, &old).unwrap();
        let error = sync(&mut db, &key, &roots, false, Some(&initial), &mut caches)
            .err()
            .unwrap();
        assert_eq!(
            crate::live_index::failure_code(&error),
            "UNSUPPORTED_VERSION"
        );
        assert!(caches.is_empty());
        assert_eq!(
            crate::live_index::load_map(&db, &good_parser_scope).unwrap(),
            saved_good_parser
        );
        assert_eq!(crate::live_index::load_map(&db, &scope).unwrap(), old);
        assert_eq!(
            crate::live_index::load_map(&db, &format!("view:{key}")).unwrap(),
            saved_view
        );
        for (id, saved) in ids.iter().zip(&saved_projection) {
            assert_eq!(
                &crate::live_index::load_map(&db, &format!("projection:{id}")).unwrap(),
                saved
            );
        }
    }
}
