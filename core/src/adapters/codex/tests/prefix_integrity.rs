use super::*;
use std::io::Write;

fn rows(input: u64) -> Vec<Value> {
    let mut header = meta("prefix");
    header["payload"]["synthetic_padding"] = json!("h".repeat(6000));
    vec![
        header,
        context("turn", "gpt-5.4", "high"),
        direct(
            "prefix",
            "turn",
            "middle",
            "2026-10-04T00:00:01Z",
            input,
            40,
            input / 10,
        ),
        json!({"type":"response_item","timestamp":"2026-10-04T00:00:02Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"t".repeat(6000)}]}}),
    ]
}

fn source(root: &Path) -> SourceInstance {
    CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.into()],
        })
        .sources
        .remove(0)
}

fn sync(db: &mut rusqlite::Connection, source: &SourceInstance, verify: bool) -> Option<Collected> {
    let transaction = db.transaction().unwrap();
    let result = incremental::sync(&transaction, source, verify).unwrap();
    transaction.commit().unwrap();
    result
}

fn checkpoint(db: &rusqlite::Connection, source: &SourceInstance, path: &Path) -> Value {
    let stored =
        crate::live_index::load_map(db, &format!("parser:{}:{VERSION}:1", source.id)).unwrap();
    let path = fs::canonicalize(path).unwrap();
    stored["checkpoints"][path.to_str().unwrap()].clone()
}

fn generation(result: &Collected) -> &str {
    let first = &result.events[0].position().generation;
    assert!(
        result
            .events
            .iter()
            .all(|event| event.position().generation == *first)
    );
    first
}

#[test]
fn middle_rewrite_with_append_replaces_old_generation_and_contribution() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(root.path(), "sessions/prefix.jsonl", &rows(100));
    let source = source(root.path());
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let initial = sync(&mut db, &source, false).unwrap();
    let original = fs::read(&path).unwrap();
    assert!(original.len() > 8192);
    let mut edited = rows(200);
    edited.push(direct(
        "prefix",
        "turn",
        "append",
        "2026-10-04T00:00:03Z",
        30,
        0,
        3,
    ));
    write(root.path(), "sessions/prefix.jsonl", &edited);
    let rewritten = fs::read(&path).unwrap();
    assert_eq!(&original[..4096], &rewritten[..4096]);
    assert_eq!(
        &original[original.len() - 4096..],
        &rewritten[original.len() - 4096..original.len()]
    );

    // A failed publication retains the previous checkpoint and authoritative events.
    let saved = checkpoint(&db, &source, &path);
    {
        let transaction = db.transaction().unwrap();
        incremental::sync(&transaction, &source, false).unwrap();
    }
    assert_eq!(checkpoint(&db, &source, &path), saved);

    let updated = sync(&mut db, &source, false).unwrap();
    assert_ne!(generation(&initial), generation(&updated));
    assert!(
        updated
            .events
            .iter()
            .all(|event| !initial.events.iter().any(|old| old.id() == event.id()))
    );
    assert_eq!(updated.measurements.len(), 2);
    assert_eq!(
        updated
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        253
    );
    assert_eq!(
        serde_json::to_value(&updated.measurements).unwrap(),
        serde_json::to_value(&collect(root.path()).measurements).unwrap()
    );
}

#[test]
fn explicit_verify_detects_same_length_middle_edit_with_unchanged_metadata() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(root.path(), "sessions/prefix.jsonl", &rows(100));
    let source = source(root.path());
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let initial = sync(&mut db, &source, false).unwrap();
    let before = fs::metadata(&path).unwrap();
    write(root.path(), "sessions/prefix.jsonl", &rows(200));
    assert_eq!(fs::metadata(&path).unwrap().len(), before.len());
    File::open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(before.modified().unwrap()))
        .unwrap();
    assert!(
        sync(&mut db, &source, false).is_none(),
        "unchanged metadata keeps the normal fast path"
    );
    let verified = sync(&mut db, &source, true).unwrap();
    assert_ne!(generation(&initial), generation(&verified));
    assert_eq!(verified.measurements.len(), 1);
    assert_eq!(verified.measurements[0].tokens.total, Some(220));
}

#[test]
fn pure_append_preserves_generation_and_existing_event_identities() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(root.path(), "sessions/prefix.jsonl", &rows(100));
    let source = source(root.path());
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let initial = sync(&mut db, &source, false).unwrap();
    let appended =
        direct("prefix", "turn", "append", "2026-10-04T00:00:03Z", 30, 0, 3).to_string() + "\n";
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(appended.as_bytes())
        .unwrap();
    let updated = sync(&mut db, &source, false).unwrap();
    assert_eq!(generation(&initial), generation(&updated));
    assert!(
        initial
            .events
            .iter()
            .all(|old| updated.events.iter().any(|event| event.id() == old.id()))
    );
    assert_eq!(updated.measurements.len(), 2);
    assert_eq!(updated.sources[0].bytes_read, appended.len() as u64);
    let saved = checkpoint(&db, &source, &path);
    assert_eq!(
        saved["prefix_sha256"],
        json!(format!("{:x}", Sha256::digest(fs::read(path).unwrap())))
    );
}

#[test]
fn partial_tail_does_not_advance_prefix_or_state_until_newline() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(root.path(), "sessions/prefix.jsonl", &rows(100));
    let source = source(root.path());
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let initial = sync(&mut db, &source, false).unwrap();
    let original = checkpoint(&db, &source, &path);
    let appended = direct("prefix", "turn", "append", "2026-10-04T00:00:03Z", 30, 0, 3).to_string();
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(appended.as_bytes()).unwrap();
    let partial = sync(&mut db, &source, false).unwrap();
    let pending = checkpoint(&db, &source, &path);
    for field in ["offset", "line", "state", "prefix_sha256"] {
        assert_eq!(
            pending[field], original[field],
            "partial tail changed {field}"
        );
    }
    assert_eq!(partial.measurements.len(), 1);
    assert!(
        partial
            .issues
            .iter()
            .any(|issue| issue.code == "incompleteTail")
    );
    file.write_all(b"\n").unwrap();
    let completed = sync(&mut db, &source, false).unwrap();
    assert_eq!(generation(&initial), generation(&completed));
    assert_eq!(completed.measurements.len(), 2);
    assert_eq!(
        checkpoint(&db, &source, &path)["offset"],
        json!(fs::metadata(path).unwrap().len())
    );
}
