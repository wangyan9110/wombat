//! Merge outcome and identity metadata independently of physical evidence collection.
use super::*;
pub(in crate::adapters::codex) fn merge_metadata(
    old: &mut Operation,
    operation: &mut Operation,
    report: &mut SourceReport,
) {
    merge_mcp(old, operation, report);
    super::work::merge(old, operation, report);
    if operation
        .timestamp
        .as_ref()
        .is_some_and(|at| old.timestamp.as_ref().is_none_or(|old| at < old))
    {
        old.timestamp.clone_from(&operation.timestamp);
        old.time_precision.clone_from(&operation.time_precision);
    }
    super::outcome::merge(old, operation, report);
    if old.kind.as_ref() == "tool" && operation.kind.as_ref() != "tool" {
        old.kind = std::mem::take(&mut operation.kind);
    }
    if old.name.as_ref() == "tool" {
        old.name = std::mem::take(&mut operation.name);
    }
    if old.turn_id.is_none() {
        old.turn_id = operation.turn_id.take();
    }
    if old.item_id.is_none() {
        old.item_id = operation.item_id.take();
    }
    if old.call_id.is_none() {
        old.call_id = operation.call_id.take();
    }
    if old.response_id.is_none() {
        old.response_id = operation.response_id.take();
    }
    if old.path.is_none() {
        old.path = operation.path.take();
    }
    if old.server.is_none() {
        old.server = operation.server.take();
    }
    if old.tool.is_none() {
        old.tool = operation.tool.take();
    }
    old.duration_ms = operation.duration_ms.or(old.duration_ms);
}

fn merge_mcp(old: &mut Operation, incoming: &mut Operation, report: &mut SourceReport) {
    let reliable = |kind: &str| {
        matches!(
            kind,
            "mcpTool" | "mcpResource" | "mcpDiscovery" | "mcpUnclassified"
        )
    };
    if old.kind.as_ref() == "mcpConflict" || incoming.kind.as_ref() == "mcpConflict" {
        old.kind = "mcpConflict".into();
        old.server = None;
        old.tool = None;
        incoming.server = None;
        incoming.tool = None;
        return;
    }
    if reliable(&old.kind) && reliable(&incoming.kind) {
        if crate::operation_association::mcp_target_conflict(old, incoming) {
            old.kind = "mcpConflict".into();
            old.server = None;
            old.tool = None;
            incoming.server = None;
            incoming.tool = None;
            issue(
                report,
                "operationIdentityConflict",
                "同一 MCP 调用的来源身份冲突",
                incoming.evidence.first().cloned(),
            );
            return;
        }
        if old.kind.as_ref() == "mcpUnclassified" {
            old.kind.clone_from(&incoming.kind);
        }
    } else if reliable(&incoming.kind) {
        old.kind.clone_from(&incoming.kind);
        old.server.clone_from(&incoming.server);
        old.tool.clone_from(&incoming.tool);
        old.name.clone_from(&incoming.name);
    }
}
