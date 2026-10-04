use super::*;
#[test]
fn live_checkpoint_restart_tail_retraction_and_full_replay_agree() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/live.jsonl",
        &[
            meta("live"),
            context("u", "gpt-5.4", "high"),
            legacy(
                counts(100, 60, 10),
                Some(counts(100, 60, 10)),
                "2026-09-29T00:00:01Z",
            ),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let sync = |verify| {
        let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
        let tx = db.transaction().unwrap();
        let result = incremental::sync(&tx, &source, verify).unwrap();
        tx.commit().unwrap();
        result
    };
    assert_eq!(sync(false).unwrap().measurements[0].tokens.total, Some(110));
    assert!(sync(false).is_none(), "unchanged source must not reparse");
    let row = direct("live", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10).to_string();
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    file.write_all(row.as_bytes()).unwrap();
    let partial = sync(false).unwrap();
    assert_eq!(partial.measurements.len(), 1);
    assert_eq!(partial.sources[0].issues[0].code, "incompleteTail");
    file.write_all(b"\n").unwrap();
    let live = sync(false).unwrap();
    let full = collect(root.path());
    assert_eq!(
        serde_json::to_value(&live.measurements).unwrap(),
        serde_json::to_value(&full.measurements).unwrap()
    );
    assert_eq!(
        live.measurements.len(),
        1,
        "late direct record replaces legacy delta"
    );
    assert_eq!(live.sources[0].bytes_read, row.len() as u64 + 1);
    assert!(
        !live.sources[0]
            .issues
            .iter()
            .any(|i| i.code == "incompleteTail")
    );
    // Parser context survives another process, including cumulative counters and model.
    for i in 2..=6 {
        let row = direct(
            "live",
            "u",
            &format!("r{i}"),
            "2026-09-29T00:00:02Z",
            100,
            60,
            10,
        )
        .to_string()
            + "\n";
        file.write_all(row.as_bytes()).unwrap();
        let live = sync(false).unwrap();
        assert_eq!(live.measurements.len(), i);
        assert_eq!(live.sources[0].bytes_read, row.len() as u64);
        assert_eq!(
            live.measurements
                .iter()
                .map(|m| m.tokens.total.unwrap())
                .sum::<u64>(),
            i as u64 * 110
        );
        assert!(
            live.measurements
                .iter()
                .all(|m| m.model.raw.as_deref() == Some("gpt-5.4"))
        );
    }
    let verified = sync(true).unwrap();
    assert_eq!(
        serde_json::to_value(verified.measurements).unwrap(),
        serde_json::to_value(collect(root.path()).measurements).unwrap()
    );
}

#[test]
fn live_transaction_rollback_truncate_missing_and_body_privacy() {
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let rows = [
        meta("t"),
        context("u", "gpt-5.4", "high"),
        direct("t", "u", "r", "2026-09-29T00:00:01Z", 100, 60, 10),
        serde_json::json!({"type":"response_item","payload":{"type":"message","content":[{"type":"input_text","text":"PRIVATE_SYNTHETIC_BODY_MUST_NOT_PERSIST"}]}}),
    ];
    let path = write(root.path(), "sessions/a.jsonl", &rows);
    let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    {
        let tx = db.transaction().unwrap();
        incremental::sync(&tx, &source, false).unwrap(); /* Simulated crash: no commit. */
    }
    assert_eq!(
        incremental::sync(&db, &source, false)
            .unwrap()
            .unwrap()
            .measurements
            .len(),
        1
    );
    let text: String = db
        .prepare("SELECT group_concat(json(payload)) FROM entries")
        .unwrap()
        .query_row([], |r| r.get(0))
        .unwrap();
    assert!(!text.contains("PRIVATE_SYNTHETIC_BODY_MUST_NOT_PERSIST"));
    write(
        root.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "gpt-5.4", "high"),
            direct("t", "u", "new", "2026-09-29T00:00:01Z", 200, 60, 20),
        ],
    );
    let replaced = incremental::sync(&db, &source, false).unwrap().unwrap();
    assert_eq!(replaced.measurements.len(), 1);
    assert_eq!(replaced.measurements[0].tokens.total, Some(220));
    fs::remove_file(path).unwrap();
    let missing = incremental::sync(&db, &source, false).unwrap().unwrap();
    assert_eq!(missing.measurements[0].tokens.total, Some(220));
    assert!(missing.issues.iter().any(|i| i.code == "sourceMissing"));
}
