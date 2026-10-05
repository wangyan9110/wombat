use super::*;

fn result(call: &str, status: Option<&str>, code: Option<i64>, output: Value) -> Value {
    json!({"type":"response_item","payload":{"type":"function_call_output","call_id":call,"status":status,"exit_code":code,"output":output}})
}
fn observed(rows: &[Value]) -> Collected {
    let root = tempfile::tempdir().unwrap();
    let mut all = vec![meta("thread"), context("turn", "model", "high")];
    all.extend_from_slice(rows);
    write(root.path(), "sessions/outcomes.jsonl", &all);
    collect(root.path())
}

#[test]
fn terminal_zero_is_success_from_top_or_structured_header_in_either_replay_order() {
    for end in [
        result("call", None, Some(0), json!("PRIVATE_RESULT_BODY")),
        result(
            "call",
            None,
            None,
            json!({"exit_code":0,"content":"PRIVATE_RESULT_BODY"}),
        ),
        result(
            "call",
            None,
            None,
            json!({"exitCode":0,"content":"PRIVATE_RESULT_BODY"}),
        ),
    ] {
        for reverse in [false, true] {
            let begin = start("call");
            let rows = if reverse {
                [end.clone(), begin.clone()]
            } else {
                [begin.clone(), end.clone()]
            };
            let mut rows = rows.to_vec();
            rows.extend([
                begin,
                output("call", json!("PRIVATE_UNKNOWN_RESULT")),
                end.clone(),
            ]);
            let out = observed(&rows);
            assert_eq!(out.operations.len(), 1);
            let op = &out.operations[0];
            assert_eq!(op.status.as_ref(), "completed");
            assert_eq!(op.exit_code, Some(0));
            assert!(!op.outcome_conflict);
            assert!(!serde_json::to_string(&out).unwrap().contains("PRIVATE_"));
        }
    }
}

#[test]
fn nonterminal_zero_and_no_error_headers_never_establish_success() {
    let mut tool = start("tool");
    tool["payload"]["exit_code"] = json!(0);
    tool["payload"]["result"] = json!({"isError":false,"exit_code":0});
    let out = observed(&[
        tool.clone(),
        tool,
        json!({"type":"event_msg","payload":{"type":"item_started","turn_id":"turn","item":{"type":"CommandExecution","id":"command","exit_code":0,"result":{"isError":false,"exit_code":0}}}}),
        json!({"type":"event_msg","payload":{"type":"item_updated","turn_id":"turn","item":{"type":"CommandExecution","id":"command","exit_code":0}}}),
    ]);
    assert_eq!(out.operations.len(), 2);
    assert!(
        out.operations
            .iter()
            .all(|op| op.status.as_ref() == "running" && !op.outcome_conflict)
    );
}

#[test]
fn negative_terminal_statuses_survive_zero_and_false_error_without_false_conflicts() {
    for (status, expected) in [
        ("failed", "failed"),
        ("declined", "declined"),
        ("interrupted", "interrupted"),
        ("cancelled", "interrupted"),
    ] {
        let end = result(
            "call",
            Some(status),
            Some(0),
            json!({"isError":false,"exit_code":0}),
        );
        for reverse in [false, true] {
            let begin = start("call");
            let rows = if reverse {
                [end.clone(), begin]
            } else {
                [begin, end.clone()]
            };
            let out = observed(&rows);
            let op = &out.operations[0];
            assert_eq!(op.status.as_ref(), expected);
            assert_eq!(op.exit_code, Some(0));
            assert!(!op.outcome_conflict);
        }
    }
    for status in ["declined", "interrupted"] {
        let out = observed(&[
            json!({"type":"event_msg","payload":{"type":"item_completed","turn_id":"turn","item":{"type":"McpToolCall","id":"native","server":"server","tool":"search","status":status,"result":{"isError":false,"content":[]}}}}),
        ]);
        assert_eq!(out.operations[0].status.as_ref(), status);
        assert!(!out.operations[0].outcome_conflict);
    }
}

#[test]
fn contradictory_top_and_nested_codes_retain_failure_and_a_sticky_unknown_exit() {
    for (top, nested) in [(0, 7), (7, 0), (7, 9)] {
        let contradictory = result(
            "call",
            None,
            Some(top),
            json!({"exit_code":nested,"content":"PRIVATE_RESULT_BODY"}),
        );
        for reverse in [false, true] {
            let begin = start("call");
            let mut rows = if reverse {
                vec![contradictory.clone(), begin.clone()]
            } else {
                vec![begin.clone(), contradictory.clone()]
            };
            rows.extend([
                result("call", None, Some(0), json!("PRIVATE_LATER_SUCCESS")),
                begin,
            ]);
            let out = observed(&rows);
            let op = &out.operations[0];
            assert_eq!(op.status.as_ref(), "failed");
            assert_eq!(op.exit_code, None);
            assert!(op.outcome_conflict);
            assert!(
                out.sources[0]
                    .issues
                    .iter()
                    .any(|issue| issue.code == "operationResultConflict")
            );
            assert!(!serde_json::to_string(&out).unwrap().contains("PRIVATE_"));
        }
    }
}

#[test]
fn independent_terminal_results_conflict_in_both_orders_and_later_zero_cannot_erase_them() {
    for status in ["failed", "declined", "interrupted"] {
        let negative = result("call", Some(status), None, json!("PRIVATE_NEGATIVE_BODY"));
        let success = result("call", None, Some(0), json!("PRIVATE_SUCCESS_BODY"));
        for reverse in [false, true] {
            let mut rows = if reverse {
                vec![negative.clone(), success.clone()]
            } else {
                vec![success.clone(), negative.clone()]
            };
            rows.extend([success.clone(), start("call"), negative.clone()]);
            let out = observed(&rows);
            assert_eq!(out.operations.len(), 1);
            let op = &out.operations[0];
            assert_eq!(op.status.as_ref(), status);
            assert!(op.outcome_conflict);
            assert_eq!(op.exit_code, None);
            assert!(
                out.sources[0]
                    .issues
                    .iter()
                    .any(|issue| issue.code == "operationResultConflict")
            );
        }
    }
}

#[test]
fn a_start_zero_does_not_conflict_with_or_overwrite_a_terminal_exit() {
    let mut begin = start("call");
    begin["payload"]["exit_code"] = json!(0);
    let end = result("call", None, Some(7), json!("PRIVATE_BODY"));
    for reverse in [false, true] {
        let mut rows = if reverse {
            vec![end.clone(), begin.clone()]
        } else {
            vec![begin.clone(), end.clone()]
        };
        rows.push(begin.clone());
        let out = observed(&rows);
        let op = &out.operations[0];
        assert_eq!(op.status.as_ref(), "failed");
        assert_eq!(op.exit_code, Some(7));
        assert!(!op.outcome_conflict);
    }
}

#[test]
fn conflicting_structured_result_headers_are_explicit_and_transcript_strings_remain_unknown() {
    let mut end = result("conflict", None, None, json!({"isError":true}));
    end["payload"]["result"] = json!({"isError":false});
    let out = observed(&[
        end,
        result(
            "plain",
            None,
            None,
            json!("Process exited with code 0\nPRIVATE_BODY"),
        ),
        result("encoded", None, None, json!("{\"exit_code\":0}")),
    ]);
    let conflicting = out
        .operations
        .iter()
        .find(|op| op.call_id.as_deref() == Some("conflict"))
        .unwrap();
    assert_eq!(conflicting.status.as_ref(), "failed");
    assert!(conflicting.outcome_conflict);
    for call in ["plain", "encoded"] {
        let op = out
            .operations
            .iter()
            .find(|op| op.call_id.as_deref() == Some(call))
            .unwrap();
        assert_eq!(op.status.as_ref(), "unknown");
        assert_eq!(op.exit_code, None);
        assert!(!op.outcome_conflict);
    }
    assert!(!serde_json::to_string(&out).unwrap().contains("PRIVATE_"));
}

#[test]
fn outcome_conflict_survives_parser_restart_and_keeps_the_previous_collected_view() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "sessions/live.jsonl",
        &[
            meta("thread"),
            context("turn", "model", "high"),
            start("call"),
            result("call", None, Some(0), json!("PRIVATE_BODY")),
        ],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
    let mut cache = incremental::Cache::default();
    let first = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    assert_eq!(first.collected.operations[0].status.as_ref(), "completed");
    writeln!(
        fs::OpenOptions::new().append(true).open(&path).unwrap(),
        "{}",
        result("call", None, Some(7), json!("PRIVATE_BODY"))
    )
    .unwrap();
    let second = incremental::sync_cached(&db, &source, false, &mut cache)
        .unwrap()
        .unwrap();
    assert!(second.collected.operations[0].outcome_conflict);
    assert_eq!(second.collected.operations[0].exit_code, None);
    assert_eq!(first.collected.operations[0].status.as_ref(), "completed");
    assert!(!first.collected.operations[0].outcome_conflict);
    writeln!(
        fs::OpenOptions::new().append(true).open(&path).unwrap(),
        "{}",
        result("call", None, Some(0), json!("PRIVATE_BODY"))
    )
    .unwrap();
    let restarted =
        incremental::sync_cached(&db, &source, false, &mut incremental::Cache::default())
            .unwrap()
            .unwrap()
            .collected;
    let op = &restarted.operations[0];
    assert_eq!(op.status.as_ref(), "failed");
    assert!(op.outcome_conflict);
    assert_eq!(op.exit_code, None);
    assert_eq!(restarted.operations, collect(root.path()).operations);
    assert!(
        !serde_json::to_string(&restarted)
            .unwrap()
            .contains("PRIVATE_")
    );
}

#[test]
fn current_operation_facts_require_explicit_conflict_observation() {
    let out = observed(&[result("call", None, Some(0), json!("PRIVATE_BODY"))]);
    let mut encoded = serde_json::to_value(out.operations[0].as_ref()).unwrap();
    assert_eq!(encoded["outcomeConflict"], json!(false));
    encoded.as_object_mut().unwrap().remove("outcomeConflict");
    assert!(serde_json::from_value::<Operation>(encoded).is_err());
}

#[test]
fn differing_failed_exit_codes_conflict_even_when_the_terminal_status_agrees() {
    for (first, second) in [(7, 9), (9, 7)] {
        let mut rows = vec![
            result("call", None, Some(first), json!("PRIVATE_RESULT")),
            result("call", None, Some(second), json!("PRIVATE_RESULT")),
        ];
        let out = observed(&rows);
        assert_eq!(out.operations[0].status.as_ref(), "failed");
        assert!(out.operations[0].outcome_conflict);
        assert_eq!(out.operations[0].exit_code, None);
        rows.push(result("call", None, Some(first), json!("PRIVATE_REPLAY")));
        let replayed = observed(&rows);
        assert_eq!(replayed.operations[0].status.as_ref(), "failed");
        assert!(replayed.operations[0].outcome_conflict);
        assert_eq!(replayed.operations[0].exit_code, None);
    }
}
