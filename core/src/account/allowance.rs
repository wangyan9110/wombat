//! Native allowance dimensions are independent facts, not interchangeable units.
use super::{safe_integer, safe_text, section};
use crate::account_dto::*;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

const MAX_BUCKETS: usize = 128;
const MAX_RESET_CREDITS: usize = 128;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rates {
    account_id: Option<String>,
    ordinary_usage_allowed: Option<bool>,
    rate_limits_by_limit_id: Option<BTreeMap<String, Value>>,
    rate_limit_reset_credits: Option<Value>,
    rate_limit_upsell: Option<Value>,
}

// Missing fields remain unknown. Invalid fields make the capture partial while
// preserving valid siblings, including other windows in the same bucket.
fn field<T>(
    value: &Value,
    key: &str,
    valid: &mut bool,
    parse: impl FnOnce(&Value) -> Option<T>,
) -> Option<T> {
    let raw = value.get(key).filter(|v| !v.is_null())?;
    let result = parse(raw);
    if result.is_none() {
        *valid = false;
    }
    result
}
fn required<T>(
    value: &Value,
    key: &str,
    valid: &mut bool,
    parse: impl FnOnce(&Value) -> Option<T>,
) -> Option<T> {
    let result = field(value, key, valid, parse);
    if result.is_none() {
        *valid = false;
    }
    result
}
fn text(value: &Value) -> Option<String> {
    safe_text(value.as_str()?)
}
fn decimal(value: &Value) -> Option<String> {
    let s = value.as_str()?;
    (s.len() <= 128 && Decimal::from_str_exact(s).is_ok()).then(|| s.to_owned())
}
fn percentage(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=100.0).contains(v))
}
fn time(value: &Value) -> Option<String> {
    DateTime::<Utc>::from_timestamp(value.as_i64()?, 0).map(|t| t.to_rfc3339())
}
fn status(reset: Option<&str>, observed: i64) -> &'static str {
    if reset
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|t| t.timestamp() <= observed)
    {
        "reset_due"
    } else {
        "current"
    }
}
fn credits(value: &Value, valid: &mut bool) -> Option<Credits> {
    if !value.is_object() {
        *valid = false;
        return None;
    }
    Some(Credits {
        balance: field(value, "balance", valid, decimal),
        has_credits: required(value, "hasCredits", valid, Value::as_bool),
        unlimited: required(value, "unlimited", valid, Value::as_bool),
    })
}
fn spend(value: &Value, valid: &mut bool, observed: i64) -> Option<SpendLimit> {
    if !value.is_object() {
        *valid = false;
        return None;
    }
    let resets_at = required(value, "resetsAt", valid, time);
    Some(SpendLimit {
        limit: required(value, "limit", valid, decimal),
        used: required(value, "used", valid, decimal),
        remaining_percent: required(value, "remainingPercent", valid, percentage),
        status: status(resets_at.as_deref(), observed).into(),
        resets_at,
    })
}
fn reset_credits(value: Value, valid: &mut bool) -> Option<ResetCredits> {
    if !value.is_object() {
        *valid = false;
        return None;
    }
    let available_count = field(&value, "availableCount", valid, |v| {
        safe_integer(v.as_u64())
    });
    if available_count.is_none() {
        *valid = false;
    }
    let mut details_truncated = false;
    let credits = match value.get("credits").filter(|v| !v.is_null()) {
        None => None,
        Some(Value::Array(rows)) => {
            let mut result = vec![];
            let mut ids = std::collections::HashSet::new();
            details_truncated = rows.len() > MAX_RESET_CREDITS;
            if details_truncated {
                *valid = false;
            }
            for row in rows.iter().take(MAX_RESET_CREDITS) {
                let Some(id) = field(row, "id", valid, text) else {
                    *valid = false;
                    continue;
                };
                if !ids.insert(id.clone()) {
                    *valid = false;
                    continue;
                }
                let kind =
                    required(row, "resetType", valid, text).unwrap_or_else(|| "unknown".into());
                let state =
                    required(row, "status", valid, text).unwrap_or_else(|| "unknown".into());
                result.push(ResetCredit {
                    id,
                    title: field(row, "title", valid, text),
                    description: field(row, "description", valid, text),
                    granted_at: required(row, "grantedAt", valid, time),
                    expires_at: field(row, "expiresAt", valid, time),
                    reset_type: if ["codexRateLimits", "unknown"].contains(&kind.as_str()) {
                        kind
                    } else {
                        *valid = false;
                        "unknown".into()
                    },
                    status: if ["available", "redeeming", "redeemed", "unknown"]
                        .contains(&state.as_str())
                    {
                        state
                    } else {
                        *valid = false;
                        "unknown".into()
                    },
                });
            }
            Some(result)
        }
        Some(_) => {
            *valid = false;
            None
        }
    };
    // Backend detail lists can be capped. Never replace its count with our length.
    Some(ResetCredits {
        available_count,
        credits,
        details_truncated,
    })
}

pub(super) fn read(
    out: &mut Response,
    raw: Value,
    account: Option<&str>,
    checked_at: &str,
    observed: i64,
) {
    let Ok(rates) = serde_json::from_value::<Rates>(raw) else {
        out.allowance.error_code = Some("NATIVE_PROTOCOL_ERROR".into());
        return;
    };
    if rates
        .account_id
        .as_deref()
        .is_some_and(|id| account != Some(id))
    {
        out.allowance = section("unavailable", None, Some("ACCOUNT_CHANGED"));
        return;
    }
    let mut valid = true;
    // A quota alias's normalModelSlug is only display metadata. Accept an explicit
    // blocked request model instead; never retain banner copy, URLs or actions.
    if rates
        .account_id
        .as_deref()
        .is_some_and(|id| account == Some(id))
        && let Some(notice) = rates.rate_limit_upsell.as_ref()
        && matches!(
            notice.get("banner_type").and_then(Value::as_str),
            Some("selected_model_limit" | "luna_reserve")
        )
        && let Some(model) = notice.get("blocked_model_slug").and_then(text)
    {
        let mut notice_valid = true;
        let resets_at = field(notice, "reset_at", &mut notice_valid, time);
        if notice_valid {
            out.model_restriction = Some(ModelRestriction { model, resets_at });
        } else {
            valid = false;
        }
    }
    out.reset_credits = rates
        .rate_limit_reset_credits
        .and_then(|v| reset_credits(v, &mut valid));
    let Some(buckets) = rates.rate_limits_by_limit_id else {
        out.allowance = section(
            if out.reset_credits.is_some() {
                "partial"
            } else {
                "unavailable"
            },
            out.reset_credits.as_ref().map(|_| checked_at),
            Some("WINDOWS_NOT_PROVIDED"),
        );
        return;
    };
    if buckets.len() > MAX_BUCKETS {
        valid = false;
    }
    for (id, value) in buckets.into_iter().take(MAX_BUCKETS) {
        if safe_text(&id).is_none() || !value.is_object() {
            valid = false;
            continue;
        }
        let mut bucket_valid = true;
        let name = field(&value, "limitName", &mut bucket_valid, text);
        let model = field(&value, "normalModelSlug", &mut bucket_valid, text);
        for role in ["primary", "secondary"] {
            let Some(window) = value.get(role).filter(|v| !v.is_null()) else {
                continue;
            };
            let Some(used_percent) = field(window, "usedPercent", &mut bucket_valid, percentage)
            else {
                bucket_valid = false;
                continue;
            };
            let resets_at = field(window, "resetsAt", &mut bucket_valid, time);
            let duration_minutes = field(window, "windowDurationMins", &mut bucket_valid, |v| {
                safe_integer(v.as_u64()).filter(|v| *v > 0)
            });
            out.windows.push(Window {
                id: format!("{id}:{role}"),
                bucket_id: id.clone(),
                bucket_name: name.clone(),
                model: model.clone(),
                used_percent,
                duration_minutes,
                status: status(resets_at.as_deref(), observed).into(),
                resets_at,
            });
        }
        let credits = value
            .get("credits")
            .filter(|v| !v.is_null())
            .and_then(|v| credits(v, &mut bucket_valid));
        let individual_limit = value
            .get("individualLimit")
            .filter(|v| !v.is_null())
            .and_then(|v| spend(v, &mut bucket_valid, observed));
        let spend_control_reached = field(
            &value,
            "spendControlReached",
            &mut bucket_valid,
            Value::as_bool,
        );
        let rate_limit_reached_type =
            field(&value, "rateLimitReachedType", &mut bucket_valid, |v| {
                let s = v.as_str()?;
                [
                    "rate_limit_reached",
                    "workspace_owner_credits_depleted",
                    "workspace_member_credits_depleted",
                    "workspace_owner_usage_limit_reached",
                    "workspace_member_usage_limit_reached",
                ]
                .contains(&s)
                .then(|| s.to_owned())
            });
        out.buckets.push(Bucket {
            id,
            name,
            model,
            credits,
            individual_limit,
            spend_control_reached,
            rate_limit_reached_type,
            status: if bucket_valid { "current" } else { "partial" }.into(),
        });
        valid &= bucket_valid;
    }
    out.ordinary_usage_allowed = rates.ordinary_usage_allowed;
    out.allowance = section(
        if valid { "available" } else { "partial" },
        Some(checked_at),
        (!valid).then_some("NATIVE_DATA_INCOMPLETE"),
    );
}
