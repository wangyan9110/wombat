//! Body-free source work metadata, attached to one canonical operation.
use super::*;

pub const WORK_OBSERVATION_VERSION: u32 = 4;
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
    MissingParsedCommands,
    MissingCommandSource,
    MissingCommandCwd,
    MissingReadPath,
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
impl FilePathChange {
    /// Preserve both native endpoints of a move, without current-filesystem resolution.
    pub(crate) fn targets(&self) -> impl Iterator<Item = &str> {
        [Some(self.path.as_str()), self.move_path.as_deref()]
            .into_iter()
            .flatten()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandSource {
    Agent,
    UserShell,
    UnifiedExecStartup,
    UnifiedExecInteraction,
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ParsedCommand {
    Read { path: Option<String> },
    ListFiles { path: Option<String> },
    Search { path: Option<String> },
    Unknown,
}
impl ParsedCommand {
    pub(crate) fn path(&self) -> Option<&str> {
        match self {
            Self::Read { path } | Self::ListFiles { path } | Self::Search { path } => {
                path.as_deref()
            }
            Self::Unknown => None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkData {
    FileChange {
        /// None is unavailable; Some(empty) is an explicit source map with no entries.
        changes: Option<Vec<FilePathChange>>,
    },
    Command {
        /// Source PathUri spelling. No filesystem lookup, URI decoding or project inference.
        cwd: Option<String>,
        source: Option<CommandSource>,
        /// Source order, including repeated parse labels. Never separate tool calls.
        parsed_commands: Option<Vec<ParsedCommand>>,
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
        match &self.data {
            WorkData::FileChange {
                changes: Some(changes),
            } => {
                anyhow::ensure!(changes.len() <= WORK_PATH_LIMIT, "work path limit");
                let mut bytes = 0usize;
                let mut previous: Option<&str> = None;
                for entry in changes {
                    anyhow::ensure!(
                        entry.targets().all(valid_work_path)
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
            WorkData::Command {
                cwd,
                parsed_commands,
                ..
            } => {
                anyhow::ensure!(
                    cwd.as_deref().is_none_or(valid_work_path),
                    "invalid command cwd"
                );
                let mut bytes = cwd.as_ref().map_or(0, String::len);
                if let Some(commands) = parsed_commands {
                    anyhow::ensure!(commands.len() <= WORK_PATH_LIMIT, "parsed command limit");
                    for command in commands {
                        anyhow::ensure!(
                            command.path().is_none_or(valid_work_path),
                            "invalid parsed command path"
                        );
                        bytes = bytes.saturating_add(command.path().map_or(0, str::len));
                    }
                }
                anyhow::ensure!(bytes <= WORK_PATH_BYTES, "command metadata byte limit");
            }
            WorkData::FileChange { changes: None } => {}
        }
        Ok(())
    }
}
pub(crate) fn valid_work_path(path: &str) -> bool {
    !path.is_empty() && !path.chars().any(char::is_control)
}
