//! Immutable generations: ledger and per-thread/turn shards, manifest committed last.
use crate::adapters::contract::*;
use crate::dto::operation_error;
use crate::pricing::{self, PriceResult, PricingContext};
use crate::usage_app_dto::SnapshotRef;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricedMeasurement {
    pub fact: Arc<Measurement>,
    pub price: Arc<PriceResult>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub file: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slice {
    pub offset: u64,
    pub length: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEntry {
    pub turn: Option<Turn>,
    pub slice: Slice,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadEntry {
    pub thread: Thread,
    pub file: FileRef,
    pub turns: BTreeMap<String, TurnEntry>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub snapshot_ref: SnapshotRef,
    pub price_revision: String,
    pub price_catalog_hash: String,
    pub sources: Vec<SourceReport>,
    pub issues: Vec<Issue>,
    pub ledger: FileRef,
    pub threads: Vec<ThreadEntry>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnData {
    pub measurements: Vec<PricedMeasurement>,
    pub operations: Vec<Operation>,
}
#[derive(Default)]
struct MemoryTurn {
    measurements: Vec<usize>,
    operations: Vec<Arc<Operation>>,
}
pub struct Snapshot {
    pub(crate) query_cache: Mutex<crate::query_cache::QueryCache>,
    live_rows: Option<Vec<Arc<PricedMeasurement>>>,
    memory_turns: Option<BTreeMap<(String, String), MemoryTurn>>,
    pub manifest: Manifest,
    directory: PathBuf,
}

mod files;
mod memory;
mod price_pool;
mod query;
#[cfg(test)]
mod tests;
pub use files::{RefreshLock, load, save};
use files::{bounded_read, corrupt, file_ref, product_home, safe_file, save_with_prices};
#[cfg(test)]
use files::{load_at, private_dir, save_at};
pub(crate) use memory::memory;
