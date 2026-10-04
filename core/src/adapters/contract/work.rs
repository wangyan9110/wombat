//! Body-free source work metadata, attached to one canonical operation.
use super::*;

pub const WORK_OBSERVATION_VERSION: u32 = 1;
pub const WORK_PATH_LIMIT: usize = 4096;
pub const WORK_PATH_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkStage {
    Proposed,
    Terminal,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Add,
    Delete,
    Update,
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGap {
    MissingChanges,
    InvalidField,
    UnknownVariant,
    ConflictingObservation,
    ResourceLimit,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilePathChange {
    /// Native path spelling, without current-filesystem resolution or sanitizing identity.
    pub path: String,
    pub change: ChangeKind,
    pub move_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkData {
    FileChange {
        /// None is unavailable; Some(empty) is an explicit source map with no entries.
        changes: Option<Vec<FilePathChange>>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkObservation {
    pub format_version: u32,
    pub stage: WorkStage,
    pub data: WorkData,
    pub gaps: Vec<WorkGap>,
}
impl WorkObservation {
    pub(crate) fn validate(&self) -> anyhow::Result<()> {
        if self.format_version != WORK_OBSERVATION_VERSION {
            return Err(crate::dto::operation_error(
                "UNSUPPORTED_VERSION",
                "不支持此来源工作观察映射",
            ));
        }
        let WorkData::FileChange { changes } = &self.data;
        if let Some(changes) = changes {
            anyhow::ensure!(changes.len() <= WORK_PATH_LIMIT, "work path limit");
            let mut bytes = 0usize;
            let mut previous: Option<&str> = None;
            for entry in changes {
                anyhow::ensure!(
                    valid_work_path(&entry.path)
                        && entry.move_path.as_deref().is_none_or(valid_work_path)
                        && (entry.move_path.is_none() || entry.change == ChangeKind::Update)
                        && previous.is_none_or(|p| p < entry.path.as_str()),
                    "invalid work path identity"
                );
                previous = Some(&entry.path);
                bytes = bytes.saturating_add(entry.path.len());
                bytes = bytes.saturating_add(entry.move_path.as_ref().map_or(0, String::len));
            }
            anyhow::ensure!(bytes <= WORK_PATH_BYTES, "work path byte limit");
        }
        Ok(())
    }
}
pub(crate) fn valid_work_path(path: &str) -> bool {
    !path.is_empty() && !path.chars().any(char::is_control)
}
