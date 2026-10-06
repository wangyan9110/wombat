//! Complete MCP parameter observations. Serde owns JSON parsing, precision and key sorting.
use super::*;
use crate::adapters::{
    codex::wire::Payload,
    contract::{MATCH_STRING_BYTES, OPERATION_MATCH_VERSION},
};
use serde::{
    Deserialize,
    de::{MapAccess, Visitor},
};
use serde_json::{Value, value::RawValue};
use std::collections::BTreeMap;
const NODE_LIMIT: usize = 4096;
const DEPTH_LIMIT: usize = 32;

/// Inspect borrowed fields, rejecting duplicates and limiting retained keys. Outputs stay borrowed.
struct Fields<'a> {
    values: BTreeMap<String, &'a RawValue>,
    duplicate: bool,
    limited: bool,
}
struct FieldsVisitor;
impl<'de> Visitor<'de> for FieldsVisitor {
    type Value = Fields<'de>;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("bounded JSON object")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut out = Fields {
            values: BTreeMap::new(),
            duplicate: false,
            limited: false,
        };
        while let Some(key) = map.next_key::<String>()? {
            let raw = map.next_value::<&RawValue>()?;
            // Serde's arbitrary-precision Value uses a reserved map token for numbers.
            // Treat a real object with that token as unsupported, never as a numeric value.
            if key == "$serde_json::private::Number" {
                return Err(serde::de::Error::custom("reserved numeric token"));
            }
            if out.limited {
                continue;
            }
            if out.values.len() >= NODE_LIMIT {
                out.values.clear();
                out.limited = true;
                continue;
            }
            out.duplicate |= out.values.insert(key, raw).is_some();
        }
        Ok(out)
    }
}
impl<'de> Deserialize<'de> for Fields<'de> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_map(FieldsVisitor)
    }
}
fn fields(raw: &RawValue) -> Result<Fields<'_>, MatchGap> {
    let value =
        serde_json::from_str::<Fields>(raw.get()).map_err(|_| MatchGap::UnsupportedParameters)?;
    if value.limited {
        Err(MatchGap::ResourceLimit)
    } else if value.duplicate {
        Err(MatchGap::UnsupportedParameters)
    } else {
        Ok(value)
    }
}
fn validate_parameters(raw: &RawValue, depth: usize, nodes: &mut usize) -> Result<(), MatchGap> {
    if depth > DEPTH_LIMIT || *nodes == 0 {
        return Err(MatchGap::ResourceLimit);
    }
    *nodes -= 1;
    match raw.get().as_bytes().first() {
        Some(b'{') => {
            for value in fields(raw)?.values.values() {
                validate_parameters(value, depth + 1, nodes)?;
            }
        }
        Some(b'[') => {
            // The complete raw representation is capped at 64 KiB before this allocation.
            let values: Vec<&RawValue> =
                serde_json::from_str(raw.get()).map_err(|_| MatchGap::UnsupportedParameters)?;
            if values.len() > *nodes {
                return Err(MatchGap::ResourceLimit);
            }
            for value in values {
                validate_parameters(value, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn parameters(raw: Option<&RawValue>) -> Result<Value, MatchGap> {
    let raw = raw.ok_or(MatchGap::MissingParameters)?;
    if raw.get().len() > MATCH_STRING_BYTES {
        return Err(MatchGap::ResourceLimit);
    }
    let decoded;
    let raw = if raw.get().starts_with('"') {
        decoded = serde_json::from_str::<String>(raw.get())
            .map_err(|_| MatchGap::UnsupportedParameters)?;
        if decoded.len() > MATCH_STRING_BYTES {
            return Err(MatchGap::ResourceLimit);
        }
        RawValue::from_string(decoded).map_err(|_| MatchGap::UnsupportedParameters)?
    } else {
        RawValue::from_string(raw.get().to_owned()).map_err(|_| MatchGap::UnsupportedParameters)?
    };
    if !raw.get().starts_with('{') {
        return Err(MatchGap::UnsupportedParameters);
    }
    let mut nodes = NODE_LIMIT;
    validate_parameters(&raw, 0, &mut nodes)?;
    let mut value: Value =
        serde_json::from_str(raw.get()).map_err(|_| MatchGap::UnsupportedParameters)?;
    value.sort_all_objects();
    Ok(value)
}
fn identity(value: Option<&str>) -> bool {
    value.is_some_and(|s| !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
}
/// A native item or invocation has explicit server/tool identity; a legacy encoded name does not.
pub(in crate::adapters::codex::operations) fn observe(
    item: &Payload<'_>,
    raw: Option<&RawValue>,
    receiver: Option<&str>,
    invocation: bool,
) -> OperationMatchObservation {
    let mut out = OperationMatchObservation {
        format_version: OPERATION_MATCH_VERSION,
        receiver_owner: receiver.map(str::to_owned),
        request_fingerprint: None,
        function_request_fingerprint: None,
        read_targets: vec![],
        expected_nonzero: false,
        gaps: vec![],
    };
    if receiver.is_none() {
        add(&mut out.gaps, MatchGap::MissingReceiver);
    }
    let checked = (|| {
        if !identity(item.server.as_deref()) || !identity(item.tool.as_deref()) {
            return Err(MatchGap::UnsupportedParameters);
        }
        let shape = fields(raw.ok_or(MatchGap::UnsupportedParameters)?)?;
        for key in shape.values.keys() {
            let allowed = if invocation {
                matches!(key.as_str(), "server" | "tool" | "arguments")
            } else {
                matches!(
                    key.as_str(),
                    "type"
                        | "id"
                        | "item_id"
                        | "itemId"
                        | "call_id"
                        | "callId"
                        | "thread_id"
                        | "turn_id"
                        | "response_id"
                        | "server"
                        | "tool"
                        | "arguments"
                        | "status"
                        | "duration"
                        | "duration_ms"
                        | "durationMs"
                        | "started_at_ms"
                        | "completed_at_ms"
                        | "result"
                )
            };
            if !allowed {
                return Err(MatchGap::UnsupportedParameters);
            }
        }
        let parameters = parameters(item.arguments)?;
        // Arbitrary precision preserves numeric values; serde normalizes exponent notation without f64 rounding.
        let request = serde_json::to_vec(&(
            "native_mcp_request_v1",
            item.server.as_deref(),
            item.tool.as_deref(),
            parameters,
        ))
        .map_err(|_| MatchGap::UnsupportedParameters)?;
        if request.len() > MATCH_STRING_BYTES {
            return Err(MatchGap::ResourceLimit);
        }
        Ok(crate::hash(request))
    })();
    match checked {
        Ok(digest) => out.request_fingerprint = Some(digest),
        Err(gap) => add(&mut out.gaps, gap),
    }
    out
}
#[cfg(test)]
mod tests;

/// Callable observations have their own digest namespace. Never reverse sanitized MCP names.
pub(in crate::adapters::codex::operations) fn function(
    item: &Payload<'_>,
    raw: Option<&RawValue>,
    receiver: Option<&str>,
) -> Option<OperationMatchObservation> {
    if item.kind.as_deref() != Some("function_call") || !identity(item.call_id.as_deref()) {
        return None;
    }
    let name = item.name.as_deref()?;
    let namespace = item.namespace.as_deref();
    let resource = matches!(
        name,
        "read_mcp_resource" | "list_mcp_resources" | "list_mcp_resource_templates"
    ) && namespace.is_none_or(|value| value == "functions");
    let encoded = name.starts_with("mcp__") && namespace.is_none_or(|value| value == "functions");
    let namespaced = namespace.is_some_and(|value| value.starts_with("mcp__"));
    if !(resource || encoded || namespaced)
        || !identity(Some(name))
        || namespace.is_some_and(|value| !identity(Some(value)))
    {
        return None;
    }
    let raw = raw?;
    if raw.get().len() > MATCH_STRING_BYTES {
        return None;
    }
    let shape = fields(raw).ok()?;
    if shape.values.keys().any(|key| {
        !matches!(
            key.as_str(),
            "type"
                | "id"
                | "item_id"
                | "itemId"
                | "call_id"
                | "callId"
                | "thread_id"
                | "turn_id"
                | "response_id"
                | "name"
                | "namespace"
                | "arguments"
                | "status"
        )
    }) {
        return None;
    }
    let parameters = parameters(item.arguments).ok()?;
    let request =
        serde_json::to_vec(&("model_mcp_callable_request_v1", namespace, name, parameters)).ok()?;
    if request.len() > MATCH_STRING_BYTES {
        return None;
    }
    Some(OperationMatchObservation {
        format_version: OPERATION_MATCH_VERSION,
        receiver_owner: receiver.map(str::to_owned),
        request_fingerprint: None,
        function_request_fingerprint: Some(crate::hash(request)),
        read_targets: vec![],
        expected_nonzero: false,
        gaps: if receiver.is_none() {
            vec![MatchGap::MissingReceiver]
        } else {
            vec![]
        },
    })
}
