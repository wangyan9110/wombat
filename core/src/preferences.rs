//! Presentation preferences are product data, separate from configuration writes.
use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Get,
    Set,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    Zh,
    En,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub action: Action,
    pub language: Option<Language>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u32,
    pub action: Action,
    pub language: Option<Language>,
}
pub fn dispatch(r: Request) -> Result<Response> {
    let file = crate::storage::data_home()?.join("user-v1/language.json");
    match r.action {
        Action::Set => {
            let language = r
                .language
                .ok_or_else(|| crate::dto::operation_error("INVALID_ARGUMENT", "需要展示语言"))?;
            crate::storage::atomic_write(&file, &serde_json::to_vec(&language)?)?;
            Ok(Response {
                output_version: 1,
                action: Action::Set,
                language: Some(language),
            })
        }
        Action::Get => {
            if r.language.is_some() {
                return Err(crate::dto::operation_error(
                    "INVALID_ARGUMENT",
                    "读取不能设置语言",
                ));
            }
            let language = match std::fs::metadata(&file) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Ok(m) if m.is_file() && m.len() <= 64 => {
                    use std::io::Read;
                    let mut bytes = Vec::new();
                    std::fs::File::open(&file)?
                        .take(65)
                        .read_to_end(&mut bytes)?;
                    if bytes.len() > 64 {
                        return Err(crate::dto::operation_error(
                            "PREFERENCES_UNAVAILABLE",
                            "语言偏好不可读取",
                        ));
                    }
                    Some(serde_json::from_slice(&bytes)?)
                }
                _ => {
                    return Err(crate::dto::operation_error(
                        "PREFERENCES_UNAVAILABLE",
                        "语言偏好不可读取",
                    ));
                }
            };
            Ok(Response {
                output_version: 1,
                action: Action::Get,
                language,
            })
        }
    }
}
