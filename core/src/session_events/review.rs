//! Body-free review observations. Hashes identify question IDs, never question/answer text.
use super::*;
use crate::adapters::contract::ReadMatchTarget;

#[derive(
    Clone, Copy, Debug, Serialize, Deserialize, schemars::JsonSchema, PartialEq, Eq, PartialOrd, Ord,
)]
#[serde(rename_all = "snake_case")]
pub enum SafetyLabel {
    RemoteScriptExecution,
    BroadDeletion,
    BroadPermissions,
    DecodeExecution,
    PossibleCredential,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReviewObservation {
    Safety {
        operation_id: Option<String>,
        request_key: Option<String>,
        labels: Vec<SafetyLabel>,
        outbound_targets: Vec<ReadMatchTarget>,
        complete: bool,
    },
    Question {
        call_id: String,
        question_ids: Vec<String>,
    },
    Permission {
        call_id: String,
    },
    Poll {
        call_id: String,
        process_key: String,
        empty_input: bool,
        wait_ms: u64,
    },
    Reply {
        call_id: String,
        answered_ids: Option<Vec<String>>,
        permissions_returned: Option<bool>,
        empty_output: Option<bool>,
    },
}
impl ReviewObservation {
    pub(super) fn validate(&self) -> anyhow::Result<()> {
        let hash = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        };
        let ids = |values: &[String]| {
            values.len() <= 32
                && values
                    .iter()
                    .enumerate()
                    .all(|(i, s)| hash(s) && !values[..i].contains(s))
        };
        match self {
            Self::Safety {
                operation_id,
                request_key,
                labels,
                outbound_targets,
                ..
            } => {
                ensure!(
                    operation_id.as_ref().is_none_or(|id| !id.is_empty()),
                    "empty safety operation"
                );
                ensure!(
                    request_key.as_ref().is_none_or(|s| hash(s)),
                    "invalid safety request key"
                );
                ensure!(
                    labels.len() <= 5
                        && labels
                            .iter()
                            .enumerate()
                            .all(|(i, l)| !labels[..i].contains(l)),
                    "invalid safety labels"
                );
                ensure!(
                    outbound_targets.len() <= 16
                        && outbound_targets
                            .iter()
                            .all(|t| crate::adapters::contract::valid_work_path(&t.path)),
                    "invalid outbound paths"
                );
            }
            Self::Question {
                call_id,
                question_ids,
            } => ensure!(
                !call_id.is_empty() && !question_ids.is_empty() && ids(question_ids),
                "invalid question identity"
            ),
            Self::Permission { call_id } => {
                ensure!(!call_id.is_empty(), "empty permission identity")
            }
            Self::Poll {
                call_id,
                process_key,
                wait_ms,
                ..
            } => ensure!(
                !call_id.is_empty() && hash(process_key) && *wait_ms <= MAX_SAFE_INTEGER,
                "invalid poll observation"
            ),
            Self::Reply {
                call_id,
                answered_ids,
                ..
            } => ensure!(
                !call_id.is_empty() && answered_ids.as_ref().is_none_or(|a| ids(a)),
                "invalid reply identity"
            ),
        }
        Ok(())
    }
}
