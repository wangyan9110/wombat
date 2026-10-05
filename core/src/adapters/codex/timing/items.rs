//! Native lifecycle endpoints and point observations; never retain item content.
use super::*;
use crate::session_events::{ActivityKind, ItemKind, NativeDuration};

pub(super) fn item_kind(kind: &str) -> Option<ItemKind> {
    Some(match kind {
        "AgentMessage" | "agentMessage" | "agent_message" => ItemKind::Assistant,
        "Reasoning" | "reasoning" => ItemKind::Reasoning,
        "UserMessage" | "userMessage" | "user_message" => ItemKind::User,
        "ContextCompaction" | "contextCompaction" | "context_compaction" => ItemKind::Compaction,
        "CommandExecution" | "commandExecution" | "command_execution" | "command" => {
            ItemKind::Command
        }
        "FileChange" | "fileChange" | "file_change" => ItemKind::File,
        "McpToolCall" | "mcpToolCall" | "mcp_tool_call" => ItemKind::Mcp,
        "FunctionCallOutput" | "function_call_output" | "custom_tool_call_output" => ItemKind::Tool,
        _ => return None,
    })
}

fn timestamp(raw: Option<&RawValue>) -> Option<i64> {
    raw.and_then(|r| serde_json::from_str::<i64>(r.get()).ok())
        .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn observe(
    p: &Payload<'_>,
    item: &Payload<'_>,
    event: &str,
    thread: Option<&str>,
    turn: Option<&str>,
    facts: &mut Facts,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) {
    let kind = item.kind.as_deref().unwrap_or("");
    let native = matches!(event, "item_started" | "item_completed");
    if native {
        let Some(item_kind) = item_kind(kind) else {
            return;
        };
        let started_at_ms = timestamp(p.started_at_ms);
        let completed_at_ms = timestamp(p.completed_at_ms);
        let native_id = item
            .id
            .as_deref()
            .or(item.item_id.as_deref())
            .or(item.call_id.as_deref())
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let mut gaps = Vec::new();
        let duration = item
            .duration
            .and_then(|raw| serde_json::from_str::<NativeDuration>(raw.get()).ok())
            .filter(|d| d.nanos < 1_000_000_000 && d.secs <= MAX_SAFE_INTEGER / 1000);
        if native_id.is_none() || thread.is_none() || turn.is_none() {
            gaps.push(Gap::MissingIdentity);
        }
        if (p.started_at_ms.is_some() && started_at_ms.is_none())
            || (item.duration.is_some() && duration.is_none())
            || (p.completed_at_ms.is_some() && completed_at_ms.is_none())
            || started_at_ms
                .zip(completed_at_ms)
                .is_some_and(|(a, b)| b < a)
        {
            gaps.push(Gap::InvalidNativeField);
            issue(
                report,
                "invalidItemTiming",
                "条目原生时间无效或顺序冲突",
                Some(evidence.clone()),
            );
        }
        record(
            facts,
            thread.map(str::to_owned),
            turn.map(str::to_owned),
            SafePayload::Item {
                item_kind,
                native_id,
                phase: if event == "item_started" {
                    Phase::Started
                } else {
                    Phase::Completed
                },
                started_at_ms,
                completed_at_ms,
                duration,
            },
            gaps,
            report,
            evidence,
        );
    } else {
        let activity = match (event, kind, item.role.as_deref()) {
            ("agent_message" | "agent_message_delta", _, _)
            | ("response_item", "message", Some("assistant")) => Some(ActivityKind::Assistant),
            ("agent_reasoning" | "agent_reasoning_delta", _, _)
            | ("response_item", "reasoning", _) => Some(ActivityKind::Reasoning),
            _ => None,
        };
        if let Some(activity) = activity {
            record(
                facts,
                thread.map(str::to_owned),
                turn.map(str::to_owned),
                SafePayload::Activity { activity },
                vec![],
                report,
                evidence,
            );
        }
    }
}
