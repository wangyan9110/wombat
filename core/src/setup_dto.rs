//! Host setup observations. Discovery, registration and collection remain distinct.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub project: Option<String>,
    pub roots: Option<Vec<String>>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u32,
    pub checked_at: String,
    pub project: Option<String>,
    pub native_version: Option<String>,
    pub discovery: crate::skill_dto::Discovery,
    pub hooks: Option<crate::config_dto::HookRegistry>,
    pub runtime_capabilities: Vec<String>,
    pub marketplace_path: Option<String>,
    pub error_codes: Vec<String>,
}
