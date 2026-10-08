//! User Skill installation and native discovery states; the Node host owns files and RPC.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Instance {
    pub name: String,
    pub path: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryStatus {
    Available,
    Ambiguous,
    Disabled,
    Missing,
    #[default]
    Unavailable,
    SelectionChanged,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub status: DiscoveryStatus,
    pub instances: Vec<Instance>,
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InstallationAction {
    Install,
    Status,
    Uninstall,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InstallationStatus {
    Absent,
    Unmanaged,
    Modified,
    Installed,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DataStatus {
    NotRequested,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub output_version: u8,
    pub action: InstallationAction,
    pub directory: String,
    pub status: InstallationStatus,
    pub version: Option<String>,
    pub source: Option<String>,
    pub discovery: Discovery,
    pub runtime_capabilities: Vec<String>,
    pub data_status: DataStatus,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HandoffCheck {
    pub project_id: String,
    pub discovery: Discovery,
    pub selected: Option<Instance>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub project_id: String,
    pub path: String,
}
