use super::super::ancestry::ForkForest;
use super::*;

#[test]
fn fork_builder_and_replay_loop_observe_cancellation_without_a_prefix_result() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let parents = HashMap::from([("child".to_owned(), "parent".to_owned())]);
    assert!(ForkForest::new_cancellable(&parents, &AtomicBool::new(true)).is_err());
    let flag = AtomicBool::new(false);
    let forest = ForkForest::new_cancellable(&parents, &flag).unwrap();
    let entries = [(0, "parent", "p"), (0, "child", "c")]
        .into_iter()
        .enumerate()
        .map(|(n, row)| {
            if n == 1 {
                flag.store(true, Ordering::Relaxed);
            }
            row
        });
    let error = forest.replays_cancellable(entries, &flag).unwrap_err();
    assert_eq!(
        error
            .downcast_ref::<crate::dto::OperationError>()
            .unwrap()
            .code,
        "CANCELLED"
    );
}

#[test]
fn indexed_fork_replays_match_independent_ancestor_walks_in_sparse_cyclic_forests() {
    let names: Vec<_> = (0..128).map(|n| format!("thread-{n}")).collect();
    let mut state = 0x7265706c6179_u64;
    let mut random = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        state
    };
    for _ in 0..30 {
        let mut parents = HashMap::new();
        for (n, name) in names.iter().enumerate() {
            let sample = random();
            if sample % 5 != 0 {
                let parent = if sample % 7 == 0 {
                    sample as usize % names.len()
                } else {
                    sample as usize % (n + 1)
                };
                parents.insert(name.clone(), names[parent].clone());
            }
        }
        let entries: Vec<_> = names
            .iter()
            .enumerate()
            .flat_map(|(n, name)| {
                (0..3)
                    .filter(move |key| (n + key) % 3 != 0)
                    .map(move |key| (key, name.as_str(), format!("event-{n}-{key}")))
            })
            .collect();
        let by_owner: BTreeMap<_, _> = entries
            .iter()
            .map(|(key, thread, id)| ((*key, *thread), id.as_str()))
            .collect();
        let mut expected = BTreeSet::new();
        for (key, thread, id) in &entries {
            let mut owner = *thread;
            let mut seen = BTreeSet::from([owner]);
            let mut ancestor = None;
            let mut cycle = false;
            while let Some(parent) = parents.get(owner) {
                if !seen.insert(parent.as_str()) {
                    cycle = true;
                    break;
                }
                if let Some(id) = by_owner.get(&(*key, parent.as_str())) {
                    ancestor = Some(*id);
                }
                owner = parent;
            }
            if !cycle && let Some(ancestor) = ancestor {
                expected.insert((id.as_str(), ancestor));
            }
        }
        let actual: BTreeSet<_> = ForkForest::new(&parents)
            .replays(
                entries
                    .iter()
                    .map(|(key, thread, id)| (*key, *thread, id.as_str())),
            )
            .into_iter()
            .collect();
        assert_eq!(actual, expected);
    }
}

#[test]
fn hundred_thousand_level_fork_chain_uses_iterative_index_and_keeps_independent_events() {
    let names: Vec<_> = (0..100_000).map(|n| format!("n{n:06}")).collect();
    let parents = names
        .windows(2)
        .map(|pair| (pair[1].clone(), pair[0].clone()))
        .collect();
    let forest = ForkForest::new(&parents);
    assert_eq!(forest.unresolved, 0);
    let repeated = forest.replays(names.iter().map(|name| (0, name.as_str(), name.as_str())));
    assert_eq!(repeated.len(), 99_999);
    assert!(repeated.iter().all(|(_, parent)| *parent == names[0]));
    assert!(
        forest
            .replays(
                names
                    .iter()
                    .enumerate()
                    .map(|(n, name)| (n, name.as_str(), name.as_str()))
            )
            .is_empty()
    );
}

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
