use super::*;
use crate::session_events::Payload as SafePayload;

fn replay(collected: &Collected) -> (Collected, SourceReport) {
    // Scope metadata is a separate explicit input until its own event mapping is complete.
    let mut facts = Facts {
        threads: collected
            .threads
            .iter()
            .map(|v| (v.id.clone(), v.clone()))
            .collect(),
        turns: collected
            .turns
            .iter()
            .map(|v| (v.id.clone(), v.clone()))
            .collect(),
        ..Default::default()
    };
    let mut report = collected.sources[0].clone();
    report.issues.clear();
    let mut observations: Vec<_> = collected
        .events
        .iter()
        .filter_map(|e| {
            let evidence = match e.payload() {
                SafePayload::Ancestry { evidence, .. } => Some(evidence),
                SafePayload::Measurement { value, .. } => value.evidence.first(),
                SafePayload::Operation { value, .. } => value.evidence.first(),
                _ => None,
            }?;
            Some((
                evidence.file.clone(),
                e.position().byte_offset,
                e.position().ordinal,
                e,
            ))
        })
        .collect();
    observations.sort_by(|a, b| (&a.0, a.1, a.2).cmp(&(&b.0, b.1, b.2)));
    for (_, _, _, event) in observations {
        super::super::event_projection::apply(&mut facts, event, &mut report);
    }
    let mut replayed = Collected::default();
    emit_facts(finish_projection(facts, &mut report), &mut replayed);
    (replayed, report)
}

#[test]
fn safe_event_replay_reproduces_late_direct_retraction_and_operation_aliases() {
    let root = tempfile::tempdir().unwrap();
    write(
        root.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("a", "gpt-5.4", "high"),
            legacy(
                counts(100, 40, 10),
                Some(counts(100, 40, 10)),
                "2026-10-04T01:00:00Z",
            ),
            json!({"type":"response_item","timestamp":"2026-10-04T01:00:01Z","payload":{"type":"function_call","id":"item","call_id":"call","name":"read_file","arguments":"{\"path\":\"/synthetic/SKILL.md\"}"}}),
            json!({"type":"response_item","timestamp":"2026-10-04T01:00:02Z","payload":{"type":"function_call_output","call_id":"call","output":"PRIVATE_BODY"}}),
            direct("t", "a", "response", "2026-10-04T01:00:00Z", 100, 40, 10),
        ],
    );
    let collected = collect(root.path());
    // Delete source files before replay: safe events and the explicitly supplied scope suffice.
    fs::remove_dir_all(root.path()).unwrap();
    let (replayed, _) = replay(&collected);
    assert_eq!(replayed.measurements.len(), 1);
    assert_eq!(replayed.measurements[0].tokens.total, Some(110));
    assert_eq!(replayed.operations.len(), 1);
    assert_eq!(replayed.operations[0].kind.as_ref(), "skillRead");
    assert_eq!(replayed.operations[0].status.as_ref(), "unknown");
    assert_eq!(
        serde_json::to_value(&replayed.measurements).unwrap(),
        serde_json::to_value(&collected.measurements).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&replayed.operations).unwrap(),
        serde_json::to_value(&collected.operations).unwrap()
    );
}

#[test]
fn fork_replay_uses_native_candidates_and_explicit_ancestry_without_rebilling() {
    let root = tempfile::tempdir().unwrap();
    let rows = [
        meta("parent"),
        context("a", "gpt-5.4", "high"),
        legacy(
            counts(100, 40, 10),
            Some(counts(100, 40, 10)),
            "2026-10-04T01:00:00Z",
        ),
    ];
    write(root.path(), "sessions/a.jsonl", &rows);
    let mut child = meta("child");
    child["payload"]["forked_from_id"] = json!("parent");
    write(
        root.path(),
        "sessions/b.jsonl",
        &[
            child,
            rows[1].clone(),
            rows[2].clone(),
            legacy(
                counts(120, 40, 12),
                Some(counts(20, 0, 2)),
                "2026-10-04T01:00:01Z",
            ),
        ],
    );
    let collected = collect(root.path());
    fs::remove_dir_all(root.path()).unwrap();
    let (replayed, _) = replay(&collected);
    assert_eq!(
        replayed
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        132
    );
    assert_eq!(
        serde_json::to_value(&replayed.measurements).unwrap(),
        serde_json::to_value(&collected.measurements).unwrap()
    );
}
