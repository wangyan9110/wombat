use super::*;
use std::path::Path;
fn source(root: &Path, title: &str) -> PathBuf {
    fs::create_dir(root.join("sessions")).unwrap();
    let path = root.join("sessions/source.jsonl");
    fs::write(
        &path,
        json!({"type":"session_meta","payload":{"id":"same-native-id"}}).to_string() + "\n",
    )
    .unwrap();
    fs::write(
        root.join("session_index.jsonl"),
        json!({"id":"same-native-id","thread_name":title,"updated_at":"2026-10-05T00:00:00Z"})
            .to_string()
            + "\n",
    )
    .unwrap();
    path
}
#[test]
fn title_observation_restore_is_source_scoped_and_rejects_corrupt_bindings() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    source(a.path(), "source A");
    source(b.path(), "source B");
    let roots = vec![
        a.path().to_string_lossy().into_owned(),
        b.path().to_string_lossy().into_owned(),
    ];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let first = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    assert_eq!(first.manifest.title_observations.len(), 2);
    let restored = restore(&db, &key, &roots).unwrap().unwrap();
    assert_eq!(
        restored.manifest.title_observations,
        first.manifest.title_observations
    );
    for observation in &restored.manifest.title_observations {
        assert_eq!(
            restored
                .manifest
                .threads
                .iter()
                .find(|t| t.thread.id == observation.thread_id)
                .unwrap()
                .thread
                .title
                .as_deref(),
            Some(observation.title.as_str())
        );
    }
    let source_id = sources(&[roots[0].clone()]).sources.remove(0).id;
    let scope = format!("projection:{source_id}");
    let original = crate::live_index::load_map(&db, &scope).unwrap();
    let mut changed = original.clone();
    let rows = changed["title_observations"].as_object_mut().unwrap();
    rows.values_mut().next().unwrap()["threadId"] = json!("foreign-thread");
    crate::live_index::save_map(&db, &scope, &changed).unwrap();
    assert!(restore(&db, &key, &roots).is_err());
    assert_eq!(crate::live_index::load_map(&db, &scope).unwrap(), changed);
}
#[test]
fn observation_headers_reject_cached_append_restore_and_mixed_fallback_without_changing_old_view() {
    use std::io::Write;
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = source(a.path(), "A");
    source(b.path(), "B");
    let roots = vec![
        a.path().to_string_lossy().into_owned(),
        b.path().to_string_lossy().into_owned(),
    ];
    let key = source_key(&roots);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut caches = BTreeMap::new();
    let first = sync(&mut db, &key, &roots, false, None, &mut caches)
        .unwrap()
        .unwrap();
    let source_id = sources(&[roots[0].clone()]).sources.remove(0).id;
    let projection = format!("projection:{source_id}");
    let parser = format!("parser:{source_id}:{}:1", adapters::codex::VERSION);
    let view = format!("view:{key}");
    let saved_view = crate::live_index::load_map(&db, &view).unwrap();
    let saved_projection = crate::live_index::load_map(&db, &projection).unwrap();
    let saved_parser = crate::live_index::load_map(&db, &parser).unwrap();
    for field in ["eventObservationVersion", "titleObservationVersion"] {
        for scope in [&projection, &parser] {
            for future in [None, Some(json!(99))] {
                crate::live_index::save_map(&db, &projection, &saved_projection).unwrap();
                crate::live_index::save_map(&db, &parser, &saved_parser).unwrap();
                let mut changed = if scope == &projection {
                    saved_projection.clone()
                } else {
                    saved_parser.clone()
                };
                changed.remove(field);
                if let Some(version) = future {
                    changed.insert(field.into(), version);
                }
                changed.insert("futureShape".into(), json!({"not":"current"}));
                crate::live_index::save_map(&db, scope, &changed).unwrap();
                for append in [false, true] {
                    if append {
                        fs::OpenOptions::new()
                            .append(true)
                            .open(&path)
                            .unwrap()
                            .write_all(b"\n")
                            .unwrap();
                    }
                    let error = sync(&mut db, &key, &roots, false, Some(&first), &mut caches)
                        .err()
                        .unwrap();
                    assert_eq!(
                        crate::live_index::failure_code(&error),
                        "UNSUPPORTED_VERSION"
                    );
                    assert_eq!(crate::live_index::load_map(&db, scope).unwrap(), changed);
                    assert_eq!(crate::live_index::load_map(&db, &view).unwrap(), saved_view);
                }
                if scope == &projection {
                    assert_eq!(
                        crate::live_index::failure_code(&restore(&db, &key, &roots).err().unwrap()),
                        "UNSUPPORTED_VERSION"
                    );
                }
            }
        }
    }
}
