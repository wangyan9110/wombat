//! External display metadata is an observation, never a session event or identity.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

pub const TITLE_OBSERVATION_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleObservation {
    pub version: u32,
    pub source_instance_id: String,
    pub file_id: String,
    pub thread_id: String,
    pub source_updated_at: String,
    pub observed_at: String,
    pub title: String,
}
impl TitleObservation {
    pub fn validate(&self) -> Result<()> {
        if self.version != TITLE_OBSERVATION_VERSION {
            return Err(crate::dto::operation_error(
                "UNSUPPORTED_VERSION",
                "不支持此标题观察版本",
            ));
        }
        ensure!(
            !self.source_instance_id.is_empty()
                && !self.file_id.is_empty()
                && !self.thread_id.is_empty(),
            "incomplete title observation scope"
        );
        ensure!(
            chrono::DateTime::parse_from_rfc3339(&self.source_updated_at).is_ok()
                && chrono::DateTime::parse_from_rfc3339(&self.observed_at).is_ok(),
            "invalid title observation time"
        );
        ensure!(
            self.title.chars().count() <= 160 && !self.title.chars().any(|ch| ch.is_control() || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{200b}')),
            "unsafe title observation"
        );
        Ok(())
    }
}

pub(crate) fn check_rows(raw: &serde_json::Value) -> Result<()> {
    if raw
        .get("titleObservations")
        .and_then(serde_json::Value::as_array)
        .is_none()
        || raw["titleObservations"].as_array().is_some_and(|rows| {
            rows.iter().any(|row| {
                row["version"].as_u64()
                    != Some(u64::from(
                        crate::observation_versions::ObservationKind::Title.current(),
                    ))
            })
        })
    {
        return Err(crate::dto::operation_error(
            "UNSUPPORTED_VERSION",
            "不支持此快照来源观察格式",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
