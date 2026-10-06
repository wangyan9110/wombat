//! Body-free matching observations. Digests establish equal requests, never equal effects.
use super::*;
pub const OPERATION_MATCH_VERSION: u32 = 1;
pub const MATCH_STRING_BYTES: usize = 64 * 1024;
pub const MATCH_TARGET_LIMIT: usize = 4096;
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchGap {
    MissingParameters,
    UnsupportedParameters,
    MissingReceiver,
    MissingHistoricalCwd,
    UnresolvedReadTarget,
    UnconfirmedRead,
    ResourceLimit,
    ConflictingObservation,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourcePathPlatform {
    Posix,
    Windows,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadMatchTarget {
    /// Historical lexical target; no current filesystem, inode or content identity.
    pub path: String,
    pub platform: SourcePathPlatform,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationMatchObservation {
    pub format_version: u32,
    /// Only protocol-owned execution within an explicitly identified source thread.
    pub receiver_owner: Option<String>,
    pub request_fingerprint: Option<String>,
    /// Native read labels verified against a supported, determinate invocation.
    pub read_targets: Vec<ReadMatchTarget>,
    /// Search/no-match exit codes cannot establish failures for retry matching.
    pub expected_nonzero: bool,
    pub gaps: Vec<MatchGap>,
}
impl OperationMatchObservation {
    pub(crate) fn validate(&self) -> anyhow::Result<()> {
        if self.format_version != OPERATION_MATCH_VERSION {
            return Err(crate::dto::operation_error(
                "UNSUPPORTED_VERSION",
                "不支持此操作匹配观察版本",
            ));
        }
        anyhow::ensure!(
            self.receiver_owner.as_deref().is_none_or(|s| !s.is_empty()
                && s.len() <= MATCH_STRING_BYTES
                && !s.chars().any(char::is_control)),
            "invalid matching receiver"
        );
        anyhow::ensure!(
            self.request_fingerprint
                .as_deref()
                .is_none_or(|s| s.len() == 64
                    && s.bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))),
            "invalid request fingerprint"
        );
        anyhow::ensure!(
            self.read_targets.len() <= MATCH_TARGET_LIMIT,
            "matching target limit"
        );
        let mut bytes = 0usize;
        let mut targets = std::collections::BTreeSet::new();
        for target in &self.read_targets {
            anyhow::ensure!(
                valid_work_path(&target.path) && targets.insert(&target.path),
                "invalid matching target"
            );
            let absolute = match target.platform {
                SourcePathPlatform::Posix => target.path.starts_with('/'),
                SourcePathPlatform::Windows => {
                    !target.path.contains('\\')
                        && ((target.path.starts_with("//")
                            && target
                                .path
                                .split('/')
                                .filter(|part| !part.is_empty())
                                .count()
                                >= 2)
                            || (target
                                .path
                                .as_bytes()
                                .first()
                                .is_some_and(u8::is_ascii_alphabetic)
                                && target.path.as_bytes().get(1) == Some(&b':')
                                && target.path.as_bytes().get(2) == Some(&b'/')))
                }
            };
            anyhow::ensure!(
                absolute && !target.path.split('/').any(|part| part == ".."),
                "unlocated matching target"
            );
            bytes = bytes.saturating_add(target.path.len());
        }
        anyhow::ensure!(bytes <= MATCH_STRING_BYTES, "matching target byte limit");
        anyhow::ensure!(
            !self.gaps.contains(&MatchGap::ConflictingObservation)
                || (self.receiver_owner.is_none()
                    && self.request_fingerprint.is_none()
                    && self.read_targets.is_empty()),
            "conflicting matching fields must be absent"
        );
        Ok(())
    }
}
