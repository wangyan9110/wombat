use super::*;
fn end(call: &str, turn: &str, server: &str, tool: &str, result: Value) -> Value {
    json!({"type":"event_msg","timestamp":"2026-10-03T00:00:02Z","payload":{"type":"mcp_tool_call_end","call_id":call,"turn_id":turn,"invocation":{"server":server,"tool":tool,"arguments":{"private":"SECRET_ARGUMENT"}},"duration":{"secs":2,"nanos":500000000},"result":result}})
}
fn request(call: &str, name: &str, arguments: Value) -> Value {
    json!({"type":"response_item","timestamp":"2026-10-03T00:00:01Z","payload":{"type":"function_call","call_id":call,"name":name,"arguments":arguments.to_string()}})
}
#[test]
fn mcp_native_completion_promotes_identity_merges_replay_and_preserves_failed_retry() {
    let dir = tempfile::tempdir().unwrap();
    let completed = end(
        "call",
        "u",
        "actual__server",
        "search",
        json!({"Ok":{"content":[{"text":"SECRET_OUTPUT"}],"isError":false}}),
    );
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "model", "low"),
            request("call", "mcp__wrong__search", json!({})),
            completed.clone(),
            completed.clone(),
            end(
                "retry",
                "u",
                "actual__server",
                "search",
                json!({"Err":"SECRET_ERROR"}),
            ),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 2);
    let first = result
        .operations
        .iter()
        .find(|o| o.call_id.as_deref() == Some("call"))
        .unwrap();
    assert_eq!(first.kind.as_ref(), "mcpTool");
    assert_eq!(first.server.as_deref(), Some("actual__server"));
    assert_eq!(first.status.as_ref(), "completed");
    assert_eq!(first.duration_ms, Some(2500));
    assert_eq!(
        result
            .operations
            .iter()
            .filter(|o| o.status.as_ref() == "failed")
            .count(),
        1
    );
    assert!(!serde_json::to_string(&result).unwrap().contains("SECRET"));
}
#[test]
fn paginated_native_item_and_explicit_resource_requests_separate_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let item = json!({"type":"event_msg","timestamp":"2026-10-03T00:00:02Z","payload":{"type":"item_completed","thread_id":"t","turn_id":"u","item":{"type":"McpToolCall","id":"read","server":"docs","tool":"read_mcp_resource","arguments":{"uri":"SECRET_URI"},"status":"failed","duration":{"secs":0,"nanos":5000000},"result":{"isError":true,"content":[{"text":"SECRET_BODY"}]}}}});
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "model", "low"),
            request(
                "read",
                "read_mcp_resource",
                json!({"server":" docs ","uri":"SECRET_URI"}),
            ),
            item,
            request("list", "list_mcp_resources", json!({"server":"docs"})),
            end(
                "list",
                "u",
                "docs",
                "list_mcp_resources",
                json!({"Ok":{"content":[]}}),
            ),
            end(
                "ambiguous",
                "u",
                "docs",
                "read_mcp_resource",
                json!({"Ok":{"content":[]}}),
            ),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 3);
    assert!(
        result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "mcpResource"
                && o.status.as_ref() == "failed"
                && o.duration_ms == Some(5))
    );
    assert!(
        result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "mcpDiscovery")
    );
    assert!(
        result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "mcpUnclassified")
    );
    assert!(!serde_json::to_string(&result).unwrap().contains("SECRET"));
}
#[test]
fn native_call_ids_are_turn_scoped_and_conflicts_stay_unbound() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            end("call", "one", "a", "search", json!({"Ok":{"content":[]}})),
            end("call", "two", "a", "search", json!({"Ok":{"content":[]}})),
            end(
                "conflict",
                "one",
                "a",
                "search",
                json!({"Ok":{"content":[]}}),
            ),
            end(
                "conflict",
                "one",
                "b",
                "search",
                json!({"Ok":{"content":[]}}),
            ),
            end(
                "conflict",
                "one",
                "a",
                "search",
                json!({"Ok":{"content":[]}}),
            ),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 3);
    let conflict = result
        .operations
        .iter()
        .find(|o| o.kind.as_ref() == "mcpConflict")
        .unwrap();
    assert!(conflict.server.is_none() && conflict.tool.is_none());
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.code == "operationIdentityConflict")
    );
}
#[test]
fn malformed_native_results_and_unknown_prefixes_cannot_become_successful_calls() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[
            meta("t"),
            context("u", "model", "low"),
            end("bad", "u", "docs", "search", json!({"Ok":{}})),
            end("", "u", "docs", "search", json!({"Ok":{"content":[]}})),
            end(
                "control",
                "u",
                "bad\nserver",
                "search",
                json!({"Ok":{"content":[]}}),
            ),
            request("prefix", "mcp__docs__search", json!({})),
            request("resource", "read_mcp_resource", json!({"server":"docs"})),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 3);
    assert!(
        result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "mcpTool" && o.status.as_ref() == "unknown")
    );
    assert!(result.operations.iter().any(|o| o.kind.as_ref() == "mcp"));
    assert!(
        !result
            .operations
            .iter()
            .any(|o| o.kind.as_ref() == "mcpResource")
    );
    assert!(result.issues.iter().any(|i| i.code == "invalidMcpIdentity"));
}
#[test]
fn fork_copies_merge_only_matching_native_attempts_and_preserve_independent_retry() {
    let dir = tempfile::tempdir().unwrap();
    let copied = end(
        "original",
        "u",
        "docs",
        "search",
        json!({"Ok":{"content":[]}}),
    );
    write(
        dir.path(),
        "sessions/parent.jsonl",
        &[meta("parent"), copied.clone()],
    );
    let mut child = meta("child");
    child["payload"]["forked_from_id"] = json!("parent");
    write(
        dir.path(),
        "sessions/child.jsonl",
        &[
            child,
            copied,
            end("retry", "v", "docs", "search", json!({"Ok":{"content":[]}})),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 2);
    let parent = result
        .threads
        .iter()
        .find(|t| t.upstream_id == "parent")
        .unwrap();
    assert_eq!(
        result
            .operations
            .iter()
            .filter(|o| o.thread_id.as_ref() == parent.id)
            .count(),
        1
    );
}
#[test]
fn unidentifiable_equal_operations_are_not_silently_collapsed() {
    let dir = tempfile::tempdir().unwrap();
    let row = json!({"type":"response_item","payload":{"type":"function_call","name":"unknown","arguments":"{}"}});
    write(
        dir.path(),
        "sessions/a.jsonl",
        &[meta("t"), row.clone(), row],
    );
    assert_eq!(collect(dir.path()).operations.len(), 2);
}

#[test]
fn forked_completion_keeps_parent_attempt_and_earliest_observation_without_payload_copy() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/parent.jsonl",
        &[
            meta("parent"),
            context("u", "model", "low"),
            request(
                "original",
                "mcp__docs__search",
                json!({"private":"SECRET_ARGUMENT"}),
            ),
        ],
    );
    let mut child = meta("child");
    child["payload"]["forked_from_id"] = json!("parent");
    write(
        dir.path(),
        "sessions/child.jsonl",
        &[
            child,
            end(
                "original",
                "u",
                "docs",
                "search",
                json!({"Ok":{"content":[]}}),
            ),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 1);
    let op = &result.operations[0];
    let parent = result
        .threads
        .iter()
        .find(|t| t.upstream_id == "parent")
        .unwrap();
    assert_eq!(op.thread_id.as_ref(), parent.id);
    assert_eq!(op.kind.as_ref(), "mcpTool");
    assert_eq!(op.status.as_ref(), "completed");
    assert_eq!(
        op.timestamp.as_deref(),
        Some("2026-10-03T00:00:01.000000000Z")
    );
    assert_eq!(op.evidence.len(), 2);
}

#[test]
fn replay_keeps_conflicting_identity_unknown_and_empty_calls_do_not_prove_resource_usage() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "sessions/parent.jsonl",
        &[
            meta("parent"),
            end("conflict", "u", "a", "search", json!({"Ok":{"content":[]}})),
            request(
                "",
                "read_mcp_resource",
                json!({"server":"a","uri":"synthetic://resource"}),
            ),
        ],
    );
    let mut child = meta("child");
    child["payload"]["forked_from_id"] = json!("parent");
    write(
        dir.path(),
        "sessions/child.jsonl",
        &[
            child,
            end("conflict", "u", "a", "search", json!({"Ok":{"content":[]}})),
            end("conflict", "u", "b", "search", json!({"Ok":{"content":[]}})),
        ],
    );
    let result = collect(dir.path());
    assert_eq!(result.operations.len(), 2);
    let conflict = result
        .operations
        .iter()
        .find(|op| op.kind.as_ref() == "mcpConflict")
        .unwrap();
    assert!(conflict.server.is_none() && conflict.tool.is_none());
    assert_eq!(conflict.evidence.len(), 3);
    assert!(
        !result
            .operations
            .iter()
            .any(|op| matches!(op.kind.as_ref(), "mcpTool" | "mcpResource"))
    );
}
