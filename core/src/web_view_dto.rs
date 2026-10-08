//! Restricted browser context. Host authorization and navigation own execution.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Page {
    Usage,
    Threads,
    Instructions,
    Extensions,
    Optimize,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub page: Page,
    pub usage: Option<crate::usage_app_dto::Request>,
    pub configuration: Option<crate::config_dto::Request>,
    pub optimization: Option<crate::optimize_dto::Request>,
}
