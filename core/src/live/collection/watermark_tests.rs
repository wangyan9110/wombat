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
    metadata.insert("watermarkVersion".into(), json!(2));
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
