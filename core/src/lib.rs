pub mod adapters;
pub mod dto;
pub mod live;
mod live_index;
#[cfg(windows)]
mod live_windows;
mod log_io;
pub mod pricing;
pub mod pricing_sync;
pub mod storage;
pub mod usage_app;
pub mod usage_app_dto;
pub mod usage_store;
use anyhow::Result;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env,
    path::{Component, Path, PathBuf},
};
pub fn hash(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value.as_ref()))
}

pub fn home() -> PathBuf {
    std::env::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
pub fn absolute(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        env::current_dir()?.join(path)
    };
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            part => result.push(part.as_os_str()),
        }
    }
    Ok(result)
}

pub fn dispatch(op: &str, args: &Value) -> Result<Value> {
    match op {
        "live_endpoint" => live::endpoint(),
        "schema_live_request" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<live::Request>(),
        )?),
        "schema_live_response" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<live::Response>(),
        )?),
        "prices" => pricing_sync::dispatch(args),
        "schema_pricing_request" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<pricing_sync::Request>(),
        )?),
        "schema_pricing_response" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<pricing_sync::Response>(),
        )?),
        "usage_app" => usage_app::dispatch(args),
        "schema_usage_app" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<usage_app_dto::Response>(),
        )?),
        "schema_usage_request" => Ok(serde_json::to_value(
            schemars::generate::SchemaSettings::draft07()
                .into_generator()
                .into_root_schema_for::<usage_app_dto::Request>(),
        )?),
        _ => Err(dto::operation_error(
            "INVALID_ARGUMENT",
            format!("未知内核操作：{op}"),
        )),
    }
}
