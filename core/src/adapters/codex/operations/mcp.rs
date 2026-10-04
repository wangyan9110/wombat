//! Native MCP outcomes and explicit built-in resource requests; no content/URI retention.
use super::*;
use serde_json::value::RawValue;

fn identity(value: &str) -> Option<String> {
    (!value.is_empty() && value.len() <= 4096 && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}
pub(super) fn native_fields(item: &Payload<'_>, op: &mut Operation) -> bool {
    let (Some(server), Some(tool)) = (
        item.server.as_deref().and_then(identity),
        item.tool.as_deref().and_then(identity),
    ) else {
        return false;
    };
    op.kind = match tool.as_str() {
        // These native names also represent built-in resource operations. A paired
        // function request identifies the operation; the name alone is ambiguous.
        "read_mcp_resource" | "list_mcp_resources" | "list_mcp_resource_templates" => {
            "mcpUnclassified"
        }
        _ => "mcpTool",
    }
    .into();
    op.name = safe_text(&tool).into();
    op.server = Some(server.into());
    op.tool = Some(tool.into());
    if let Some(raw) = item.duration {
        op.duration_ms = duration(raw);
    }
    true
}
#[derive(Deserialize)]
struct NativeDuration {
    secs: u64,
    nanos: u32,
}
pub(super) fn duration(raw: &RawValue) -> Option<u64> {
    let value: NativeDuration = serde_json::from_str(raw.get()).ok()?;
    if value.nanos >= 1_000_000_000 {
        return None;
    }
    value
        .secs
        .checked_mul(1000)?
        .checked_add(u64::from(value.nanos) / 1_000_000)
        .filter(|n| *n <= MAX_SAFE_INTEGER)
}
#[derive(Deserialize)]
struct ResultHeader<'a> {
    #[serde(rename = "isError", alias = "is_error")]
    is_error: Option<bool>,
    #[serde(borrow)]
    content: Option<&'a RawValue>,
}
pub(super) fn result_status(raw: &RawValue) -> Option<&'static str> {
    let header: ResultHeader = serde_json::from_str(raw.get()).ok()?;
    if header.is_error != Some(true) && header.content.is_none_or(|raw| !raw.get().starts_with('['))
    {
        return None;
    }
    Some(if header.is_error.unwrap_or(false) {
        "failed"
    } else {
        "completed"
    })
}
pub(super) fn legacy_status(raw: Option<&RawValue>) -> Option<&'static str> {
    #[derive(Deserialize)]
    enum Outcome<'a> {
        Ok(#[serde(borrow)] &'a RawValue),
        Err(#[serde(borrow)] &'a RawValue),
    }
    match serde_json::from_str::<Outcome>(raw?.get()).ok()? {
        Outcome::Ok(result) => result_status(result),
        Outcome::Err(error) if error.get().starts_with('"') => Some("failed"),
        _ => None,
    }
}
pub(super) fn resource_request(item: &Payload<'_>, op: &mut Operation) {
    if item.kind.as_deref() != Some("function_call")
        || op.call_id.is_none()
        || item
            .namespace
            .as_deref()
            .is_some_and(|ns| ns != "functions")
    {
        return;
    }
    let name = item.name.as_deref().unwrap_or("");
    if !matches!(
        name,
        "read_mcp_resource" | "list_mcp_resources" | "list_mcp_resource_templates"
    ) {
        return;
    }
    #[derive(Deserialize)]
    struct Arguments {
        server: Option<String>,
        uri: Option<String>,
    }
    let Some(raw) = item.arguments else {
        return;
    };
    let decoded;
    let json = if raw.get().starts_with('"') {
        decoded = serde_json::from_str::<String>(raw.get()).ok();
        decoded.as_deref()
    } else {
        Some(raw.get())
    };
    let Some(args) = json.and_then(|s| serde_json::from_str::<Arguments>(s).ok()) else {
        return;
    };
    let Some(server) = args.server.as_deref().map(str::trim).and_then(identity) else {
        return;
    };
    if name == "read_mcp_resource" && args.uri.as_deref().is_none_or(|s| s.trim().is_empty()) {
        return;
    }
    op.kind = if name == "read_mcp_resource" {
        "mcpResource"
    } else {
        "mcpDiscovery"
    }
    .into();
    op.server = Some(server.into());
    op.tool = Some(name.into());
}
