use super::*;

#[test]
fn cyclic_forks_keep_operations_and_native_counters_with_explicit_coverage_gap() {
    let dir = tempfile::tempdir().unwrap();
    let inherited = legacy(
        counts(100, 60, 10),
        Some(counts(100, 60, 10)),
        "2026-09-29T00:00:01Z",
    );
    for (thread, parent) in [
        ("a", Some("b")),
        ("b", Some("a")),
        ("descendant", Some("b")),
        ("root", None),
        ("child", Some("root")),
    ] {
        let mut metadata = meta(thread);
        if let Some(parent) = parent {
            metadata["payload"]["forked_from_id"] = json!(parent);
        }
        write(
            dir.path(),
            &format!("sessions/{thread}.jsonl"),
            &[
                metadata,
                context("u", "gpt-5.4", "low"),
                inherited.clone(),
                json!({"type":"response_item","payload":{"type":"function_call","call_id":"call","name":"read_file","arguments":"{}"}}),
            ],
        );
    }
    let result = collect(dir.path());
    assert_eq!(result.measurements.len(), 4);
    assert_eq!(
        result
            .measurements
            .iter()
            .map(|m| m.tokens.total.unwrap())
            .sum::<u64>(),
        440
    );
    assert_eq!(result.operations.len(), 4);
    assert!(result.issues.iter().any(|i| i.code == "forkAncestryCycle"));
    assert_eq!(result.sources[0].status, "partial");
}
