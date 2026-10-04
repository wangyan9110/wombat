//! Source operation identities, safe metadata and native MCP evidence.
use super::*;
mod mcp;
mod merge;
mod replay;
mod work;
pub(super) use merge::merge_metadata;
pub(super) fn operation_id(thread: &str, turn: Option<&str>, identity: &str) -> String {
    stable_id(&[thread, "operation", turn.unwrap_or(""), identity])
}
#[allow(clippy::too_many_arguments)]
pub(super) fn empty_operation(
    thread: &str,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: &EvidenceRef,
    kind: &str,
    name: &str,
    identity: &str,
) -> Operation {
    Operation {
        id: operation_id(thread, turn.as_deref(), identity),
        thread_id: thread.into(),
        turn_id: turn.map(Into::into),
        item_id: None,
        call_id: None,
        response_id: None,
        kind: kind.into(),
        name: safe_text(name).into(),
        sequence: evidence.line,
        timestamp: time,
        time_precision: precision(raw_time).into(),
        status: "unknown".into(),
        exit_code: None,
        duration_ms: None,
        path: None,
        work: None,
        server: None,
        tool: None,
        evidence: vec![evidence.clone()],
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn operation(
    p: &Payload<'_>,
    item: &Payload<'_>,
    event: &str,
    thread: &str,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    _fingerprint: &str,
    facts: &mut Facts,
    report: &mut SourceReport,
) {
    let kind = item.kind.as_deref().unwrap_or("");
    let (operation_kind, name, completed) = match kind {
        "function_call" | "custom_tool_call" => {
            ("tool", item.name.as_deref().unwrap_or("tool"), false)
        }
        "function_call_output" | "custom_tool_call_output" | "FunctionCallOutput" => {
            ("tool", "tool", true)
        }
        "CommandExecution" | "commandExecution" | "command_execution" | "command" => {
            ("command", "exec_command", event == "item_completed")
        }
        "FileChange" | "fileChange" | "file_change" => {
            ("file", "apply_patch", event == "item_completed")
        }
        "patch_apply_end" => ("file", "apply_patch", true),
        "McpToolCall" | "mcpToolCall" | "mcp_tool_call" => (
            "mcp",
            item.tool.as_deref().unwrap_or("MCP"),
            event == "item_completed",
        ),
        "webSearch" | "web_search" => ("search", "web_search", event == "item_completed"),
        "imageGeneration" | "image_generation" => {
            ("image", "image_generation", event == "item_completed")
        }
        "collabAgentToolCall" | "collab_agent_tool_call" => {
            ("agent", "agent", event == "item_completed")
        }
        // Conversation bodies and hidden reasoning are intentionally not projection facts.
        _ => return,
    };
    let call = item
        .call_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or(p.call_id.as_deref().filter(|id| !id.is_empty()));
    let item_id = item
        .item_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or(item.id.as_deref().filter(|id| !id.is_empty()))
        .or(p.item_id.as_deref().filter(|id| !id.is_empty()));
    let anonymous = format!("{}:{}", evidence.file, evidence.line);
    let identity = call
        .or(item_id)
        .filter(|id| !id.is_empty())
        .unwrap_or(&anonymous);
    let mut op = empty_operation(
        thread,
        turn,
        time,
        raw_time,
        &evidence,
        operation_kind,
        name,
        identity,
    );
    op.call_id = call.map(str::to_owned);
    op.item_id = item_id.map(str::to_owned);
    op.response_id = item
        .response_id
        .as_deref()
        .or(p.response_id.as_deref())
        .map(safe_text);
    op.status = match item.status.as_deref() {
        Some("failed" | "error") => "failed",
        Some("interrupted" | "cancelled") => "interrupted",
        Some("declined") => "declined",
        Some("completed" | "success") => "completed",
        _ if completed && operation_kind != "tool" && operation_kind != "mcp" => "completed",
        _ if completed => "unknown",
        _ => "running",
    }
    .into();
    op.exit_code = item.exit_code;
    op.duration_ms = item
        .duration_ms
        .and_then(timing::safe_integer)
        .or_else(|| item.duration.and_then(mcp::duration));
    if op.exit_code.is_some_and(|code| code != 0) {
        op.status = "failed".into();
    }
    op.path = item.path.as_deref().map(safe_text);
    if operation_kind == "file" {
        op.work = Some(work::file_changes(item, completed, report, &evidence));
        // Legacy success is outcome evidence, not permission to erase a declined status.
        if item.success.is_some_and(|r| r.get() == "false") && op.status.as_ref() != "declined" {
            op.status = "failed".into();
        }
    } else if operation_kind == "command" {
        op.work = Some(work::command(item, completed, report, &evidence));
    }
    op.server = item.server.as_deref().map(|s| safe_text(s).into());
    op.tool = item.tool.as_deref().map(|s| safe_text(s).into());
    #[derive(Deserialize)]
    struct Args {
        path: Option<String>,
        file_path: Option<String>,
    }
    let args = item.arguments.or(item.input);
    if matches!(
        name,
        "read_file" | "view_image" | "write_file" | "edit_file"
    ) && let Some(raw) = args
    {
        // Tool arguments may be JSON encoded as a string; parse only path fields.
        let decoded;
        let json = if raw.get().starts_with('"') {
            decoded = serde_json::from_str::<String>(raw.get()).ok();
            decoded.as_deref()
        } else {
            Some(raw.get())
        };
        if let Some(args) = json.and_then(|s| serde_json::from_str::<Args>(s).ok()) {
            op.path = args.path.or(args.file_path).as_deref().map(safe_text);
        }
    }
    if name == "read_file"
        && op
            .path
            .as_deref()
            .is_some_and(|path| Path::new(path).file_name().is_some_and(|n| n == "SKILL.md"))
    {
        op.kind = "skillRead".into();
    }
    if name.starts_with("mcp__") {
        let mut segments = name.splitn(3, "__");
        segments.next();
        op.server = segments.next().map(|s| safe_text(s).into());
        op.tool = segments.next().map(|s| safe_text(s).into());
        op.kind = "mcp".into();
    }
    if operation_kind == "mcp" {
        if call.or(item_id).is_none_or(str::is_empty) || !mcp::native_fields(item, &mut op) {
            issue(
                report,
                "invalidMcpIdentity",
                "MCP 记录缺少可靠调用身份",
                Some(evidence),
            );
            return;
        }
        if op.status.as_ref() != "failed"
            && let Some(status) = item.result.and_then(mcp::result_status)
        {
            op.status = status.into();
        }
    } else {
        mcp::resource_request(item, &mut op);
    }
    #[derive(Deserialize)]
    struct ResultMetadata {
        #[serde(alias = "isError")]
        is_error: Option<bool>,
        exit_code: Option<i64>,
        duration_ms: Option<u64>,
    }
    if let Some(metadata) = item
        .result
        .or(item.output)
        .filter(|r| r.get().starts_with('{'))
        .and_then(|r| serde_json::from_str::<ResultMetadata>(r.get()).ok())
    {
        if metadata.is_error == Some(true) {
            op.status = "failed".into();
        } else if metadata.is_error == Some(false)
            && completed
            && op.status.as_ref() != "failed"
            && operation_kind != "mcp"
        {
            op.status = "completed".into();
        }
        op.exit_code = metadata.exit_code.or(op.exit_code);
        op.duration_ms = metadata
            .duration_ms
            .filter(|n| *n <= MAX_SAFE_INTEGER)
            .or(op.duration_ms);
        if op.exit_code.is_some_and(|code| code != 0) {
            op.status = "failed".into();
        }
    }
    facts.operation(op, report);
}

#[allow(clippy::too_many_arguments)]
pub(super) fn mcp_event(
    p: &Payload<'_>,
    event: &str,
    thread: &str,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    facts: &mut Facts,
    report: &mut SourceReport,
) {
    let invocation = p
        .invocation
        .and_then(|raw| serde_json::from_str::<Payload>(raw.get()).ok());
    let Some((call, invocation)) = p
        .call_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .zip(invocation)
    else {
        issue(
            report,
            "invalidMcpIdentity",
            "MCP 记录缺少可靠调用身份",
            Some(evidence),
        );
        return;
    };
    let mut op = empty_operation(thread, turn, time, raw_time, &evidence, "mcp", "MCP", call);
    if !mcp::native_fields(&invocation, &mut op) {
        issue(
            report,
            "invalidMcpIdentity",
            "MCP 记录缺少可靠服务身份",
            Some(evidence),
        );
        return;
    }
    op.call_id = Some(call.into());
    op.duration_ms = p.duration.and_then(mcp::duration);
    op.status = if event == "mcp_tool_call_begin" {
        "running"
    } else {
        mcp::legacy_status(p.result).unwrap_or("unknown")
    }
    .into();
    facts.operation(op, report);
}
