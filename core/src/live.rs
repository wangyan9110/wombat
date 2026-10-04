//! On-demand local usage service. One writer commits cursors and derived facts together.
use crate::{
    adapters::{self, contract::*},
    dto::operation_error,
    usage_app_dto,
    usage_store::Snapshot,
};
use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, mpsc},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub query: usage_app_dto::Request,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub verify: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Auto,
    Fresh,
    Cached,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Freshness {
    pub status: String,
    /// Ephemeral task headers; no completed ledger or coverage is available yet.
    #[serde(default)]
    pub initial_scan: bool,
    pub checked_at: Option<String>,
    pub revision: String,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u32,
    pub result: usage_app_dto::Response,
    pub freshness: Freshness,
}
struct Entry {
    roots: Vec<String>,
    views: VecDeque<(Instant, Arc<Snapshot>)>,
    attempt: u64,
    checked: Option<String>,
    error: Option<String>,
    error_code: Option<&'static str>,
    touched: Instant,
    syncing: bool,
    last_sync: Instant,
    following: bool,
    requested: u64,
    completed: u64,
    pending: Option<SyncWork>,
    running: Option<SyncWork>,
}
impl Entry {
    fn new(roots: Vec<String>) -> Self {
        Self {
            roots,
            views: VecDeque::new(),
            attempt: 0,
            checked: None,
            error: None,
            error_code: None,
            touched: Instant::now(),
            syncing: false,
            last_sync: Instant::now(),
            following: false,
            requested: 0,
            completed: 0,
            pending: None,
            running: None,
        }
    }
}
type Shared = Arc<(Mutex<BTreeMap<String, Entry>>, Condvar)>;
struct Job {
    key: String,
}
#[derive(Clone, Copy)]
struct SyncWork {
    ticket: u64,
    verify: bool,
}

fn directory() -> Result<PathBuf> {
    let path = crate::storage::data_home()?.join("live-v2");
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&path)?;
    Ok(path)
}
#[cfg(windows)]
fn socket_path() -> Result<PathBuf> {
    Ok(PathBuf::from(format!(
        r"\\.\pipe\wombat-{}",
        &crate::hash(fs::canonicalize(directory()?)?.to_string_lossy().as_bytes())[..24]
    )))
}
#[cfg(unix)]
fn socket_path() -> Result<PathBuf> {
    let root = directory()?;
    // Unix-domain paths are short even when the product data directory is deeply nested.
    let parent = std::path::Path::new("/tmp").join(format!(
        "wombat-{}",
        &crate::hash(fs::canonicalize(&root)?.to_string_lossy().as_bytes())[..24]
    ));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&parent) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = fs::symlink_metadata(&parent)?;
        if !meta.is_dir() || meta.mode() & 0o077 != 0 || meta.uid() != fs::metadata(&root)?.uid() {
            return Err(operation_error("EACCES", "实时用量接口目录权限不正确"));
        }
    }
    Ok(parent.join("usage.sock"))
}
pub fn endpoint() -> Result<Value> {
    Ok(json!({"protocolVersion":1,"socket":socket_path()?}))
}
mod collection;
mod preview;
mod query;
mod scheduling;
mod selection;
mod transport;
use collection::{restore, source_key, sources, sync};
use query::{config_query, query};
use selection::select_view;
pub use transport::serve;
