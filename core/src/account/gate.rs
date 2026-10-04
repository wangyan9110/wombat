//! A fresh, native model-bound restriction may stop a handoff; uncertainty may not.
use super::safe_text;
use crate::{account_dto::*, dto::operation_error};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Deserialize;

const OBSERVATION_SECONDS: i64 = 60;
const LOW_REMAINING_PERCENT: f64 = 10.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub account: Response,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub now: String,
}
fn timestamp(value: Option<&str>) -> Option<i64> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|v| v.timestamp())
}
fn current(value: Option<&str>, now: i64) -> bool {
    value.is_none() || timestamp(value).is_some_and(|reset| reset > now)
}
fn until(checked: i64, reset: Option<&str>) -> Option<String> {
    let deadline = checked.saturating_add(OBSERVATION_SECONDS);
    DateTime::<Utc>::from_timestamp(timestamp(reset).map_or(deadline, |r| r.min(deadline)), 0)
        .map(|t| t.to_rfc3339())
}
pub(crate) fn evaluate(r: Request) -> Result<AllowanceAssessment> {
    let now = timestamp(Some(&r.now))
        .ok_or_else(|| operation_error("INVALID_ARGUMENT", "Invalid allowance evaluation time"))?;
    let account = r.account;
    let mut out = AllowanceAssessment {
        model: r.model.as_deref().and_then(safe_text),
        provider: r.provider.as_deref().and_then(safe_text),
        checked_at: account.allowance.checked_at.clone(),
        reason: "account_unavailable".into(),
        ..Default::default()
    };
    if account.account.status != "available"
        || account
            .identity
            .as_ref()
            .is_none_or(|i| i.kind != "chatgpt")
    {
        return Ok(out);
    }
    if out.model.is_none() || out.provider.is_none() {
        out.reason = "target_unknown".into();
        return Ok(out);
    }
    if out.provider.as_deref() != Some("openai") {
        out.reason = "other_provider".into();
        return Ok(out);
    }
    let checked = timestamp(account.allowance.checked_at.as_deref());
    if !matches!(account.allowance.status.as_str(), "available" | "partial")
        || checked.is_none_or(|checked| checked > now || now - checked >= OBSERVATION_SECONDS)
    {
        out.reason = "observation_not_current".into();
        return Ok(out);
    }
    let checked = checked.expect("checked above");
    out.valid_until = until(checked, None);
    if out.valid_until.is_none() {
        out.reason = "observation_not_current".into();
        return Ok(out);
    }
    if let Some(restriction) = account
        .model_restriction
        .as_ref()
        .filter(|r| Some(&r.model) == out.model.as_ref() && current(r.resets_at.as_deref(), now))
    {
        out.status = AllowanceStatus::Blocked;
        out.reason = "native_model_restriction".into();
        out.valid_until = until(checked, restriction.resets_at.as_deref());
        return Ok(out);
    }
    // Ordinary account allowance can inform a warning, never prove which quota
    // an arbitrary request model consumes. normalModelSlug is not a mapping.
    out.reason = "no_applicable_restriction".into();
    let Some(bucket) = account
        .buckets
        .iter()
        .find(|b| b.id == "codex" && b.status == "current")
    else {
        return Ok(out);
    };
    let window = account
        .windows
        .iter()
        .filter(|w| {
            w.bucket_id == bucket.id
                && w.status == "current"
                && current(w.resets_at.as_deref(), now)
                && w.used_percent.is_finite()
                && (0.0..=100.0).contains(&w.used_percent)
        })
        .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent));
    if let Some(window) = window {
        if (0.0..=LOW_REMAINING_PERCENT).contains(&(100.0 - window.used_percent)) {
            out.status = AllowanceStatus::Low;
            out.reason = "low_ordinary_allowance".into();
        } else if account.ordinary_usage_allowed == Some(true)
            && bucket.rate_limit_reached_type.is_none()
            && bucket.spend_control_reached != Some(true)
        {
            out.status = AllowanceStatus::Available;
            out.reason = "ordinary_usage_allowed".into();
        }
        if out.status != AllowanceStatus::Unknown {
            out.bucket_id = Some(bucket.id.clone());
            out.window_id = Some(window.id.clone());
            out.valid_until = until(checked, window.resets_at.as_deref());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
