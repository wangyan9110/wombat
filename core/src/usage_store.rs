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
    sync::Arc,
};

const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricedMeasurement {
    pub fact: Arc<Measurement>,
    pub price: PriceResult,
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
    live_rows: Option<Vec<Arc<PricedMeasurement>>>,
    memory_turns: Option<BTreeMap<(String, String), MemoryTurn>>,
    pub manifest: Manifest,
    directory: PathBuf,
    legacy_ledger: Option<Vec<PricedMeasurement>>,
}

fn corrupt(message: impl Into<String>) -> anyhow::Error {
    operation_error("SNAPSHOT_CORRUPT", message)
}
fn product_home() -> Result<PathBuf> {
    Ok(crate::storage::data_home()?.join("usage-v3"))
}
fn private_dir(path: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    Ok(())
}
pub struct RefreshLock {
    _file: fs::File,
}
impl RefreshLock {
    pub fn acquire() -> Result<Self> {
        Self::at(&product_home()?)
    }
    fn at(root: &Path) -> Result<Self> {
        private_dir(root)?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(root.join("refresh.lock"))?;
        file.try_lock()
            .map_err(|_| operation_error("UPDATE_BUSY", "用量正在更新"))?;
        Ok(Self { _file: file })
    }
}
fn file_ref(file: &str, bytes: &[u8]) -> FileRef {
    FileRef {
        file: file.into(),
        sha256: crate::hash(bytes),
    }
}
fn save_json<T: Serialize>(directory: &Path, name: &str, value: &T) -> Result<FileRef> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(operation_error("RESOURCE_LIMIT", "快照分片超过512 MiB"));
    }
    crate::storage::atomic_write(&directory.join(name), &bytes)?;
    Ok(file_ref(name, &bytes))
}
pub fn save(collected: Collected) -> Result<Snapshot> {
    save_with_prices(&product_home()?, collected, crate::pricing_sync::current()?)
}
#[cfg(test)]
fn save_at(root: &Path, collected: Collected) -> Result<Snapshot> {
    save_with_prices(
        root,
        collected,
        crate::pricing_sync::current_at(&root.join("prices"))?,
    )
}
fn save_with_prices(
    root: &Path,
    collected: Collected,
    prices: crate::pricing_sync::Response,
) -> Result<Snapshot> {
    private_dir(root)?;
    let id = uuid::Uuid::new_v4().to_string();
    let generation = root.join("generations").join(&id);
    private_dir(&generation)?;
    let pending = tempfile::Builder::new()
        .prefix(".pending-")
        .tempdir_in(&generation)?;
    let directory = pending.path();
    let records: Vec<_> = collected
        .measurements
        .into_iter()
        .map(|fact| {
            let price = pricing::price_with_catalog(
                &fact.model,
                &fact.tokens,
                &PricingContext {
                    request_scoped: fact.request_scoped,
                },
                &prices.catalog,
                &prices.catalog_hash,
            );
            PricedMeasurement { fact, price }
        })
        .collect();
    // Reject unusable totals before publishing any new latest pointer.
    crate::usage_app::summarize(&records.iter().collect::<Vec<_>>())?;
    let ledger = save_json(directory, "ledger.json", &records)?;
    let mut by_thread: BTreeMap<String, BTreeMap<String, TurnData>> = BTreeMap::new();
    for row in &records {
        if let Some(thread) = &row.fact.thread_id {
            by_thread
                .entry(thread.clone())
                .or_default()
                .entry(
                    row.fact
                        .turn_id
                        .clone()
                        .unwrap_or_else(|| "unassigned".into()),
                )
                .or_default()
                .measurements
                .push(row.clone());
        }
    }
    for op in collected.operations {
        by_thread
            .entry(op.thread_id.clone())
            .or_default()
            .entry(op.turn_id.clone().unwrap_or_else(|| "unassigned".into()))
            .or_default()
            .operations
            .push(op.as_ref().clone());
    }
    let turns: BTreeMap<_, _> = collected
        .turns
        .into_iter()
        .map(|t| ((t.thread_id.clone(), t.id.clone()), t))
        .collect();
    for (thread, turn) in turns.keys() {
        by_thread
            .entry(thread.clone())
            .or_default()
            .entry(turn.clone())
            .or_default();
    }
    let mut threads = Vec::new();
    for thread in collected.threads {
        let filename = format!("thread-{}.jsonl", crate::hash(&thread.id));
        let mut bytes = Vec::new();
        let mut index = BTreeMap::new();
        for (turn_id, data) in by_thread.remove(&thread.id).unwrap_or_default() {
            let mut segment = serde_json::to_vec(&data)?;
            segment.push(b'\n');
            if (bytes.len() + segment.len()) as u64 > MAX_FILE_BYTES {
                return Err(operation_error("RESOURCE_LIMIT", "对话分片超过512 MiB"));
            }
            let slice = Slice {
                offset: bytes.len() as u64,
                length: segment.len() as u64,
                sha256: crate::hash(&segment),
            };
            bytes.extend(segment);
            index.insert(
                turn_id.clone(),
                TurnEntry {
                    turn: turns.get(&(thread.id.clone(), turn_id)).cloned(),
                    slice,
                },
            );
        }
        crate::storage::atomic_write(&directory.join(&filename), &bytes)?;
        threads.push(ThreadEntry {
            thread,
            file: file_ref(&filename, &bytes),
            turns: index,
        });
    }
    if !by_thread.is_empty() {
        return Err(operation_error("INVALID_FACTS", "存在没有对话元数据的记录"));
    }
    let manifest = Manifest {
        schema_version: 3,
        snapshot_ref: SnapshotRef {
            snapshot_id: id,
            created_at: chrono::Utc::now().to_rfc3339(),
            selector: None,
        },
        price_revision: prices.catalog.revision,
        price_catalog_hash: prices.catalog_hash,
        sources: collected.sources,
        issues: collected.issues,
        ledger,
        threads,
    };
    save_json(directory, "manifest.json", &manifest)?;
    // Moving one completed directory publishes all files together. latest is independent of v1/v2.
    let final_dir = generation.join("committed");
    fs::rename(directory, &final_dir)?;
    #[cfg(unix)]
    fs::File::open(&generation)?.sync_all()?;
    crate::storage::atomic_write(
        &root.join("latest.json"),
        &serde_json::to_vec(&manifest.snapshot_ref)?,
    )?;
    Ok(Snapshot {
        manifest,
        directory: final_dir,
        legacy_ledger: None,
        memory_turns: None,
        live_rows: None,
    })
}
fn bounded_read(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|e| corrupt(format!("快照文件无法读取：{e}")))?;
    if file.metadata()?.len() > MAX_FILE_BYTES {
        return Err(operation_error("RESOURCE_LIMIT", "快照文件超过512 MiB"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(operation_error("RESOURCE_LIMIT", "快照文件超过512 MiB"));
    }
    Ok(bytes)
}
fn safe_file(directory: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty() || Path::new(name).components().count() != 1 || name == "." || name == ".." {
        return Err(corrupt("非法快照分片路径"));
    }
    let path = directory.join(name);
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(corrupt("快照分片不能为符号链接"));
    }
    Ok(path)
}
pub fn load(id: Option<&str>) -> Result<Snapshot> {
    load_at(&product_home()?, id)
}
fn load_at(root: &Path, id: Option<&str>) -> Result<Snapshot> {
    let id = match id {
        Some(id) => id.to_owned(),
        None => {
            if !root.join("latest.json").is_file() {
                // A legacy snapshot remains readable without rewriting it.
                let old = root.parent().unwrap_or(root).join("latest.json");
                if old.is_file() {
                    let pointer: serde_json::Value = serde_json::from_slice(&bounded_read(&old)?)?;
                    if let Some(file) = pointer["snapshot"].as_str() {
                        return load_legacy(Path::new(file));
                    }
                }
                return Err(operation_error("NO_SNAPSHOT", "尚无用量数据，请先更新用量"));
            }
            let reference: SnapshotRef =
                serde_json::from_slice(&bounded_read(&root.join("latest.json"))?)
                    .map_err(|_| corrupt("最近快照指针损坏"))?;
            reference.snapshot_id
        }
    };
    if Path::new(&id).is_file() {
        return load_legacy(Path::new(&id));
    }
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(operation_error("INVALID_ARGUMENT", "非法快照身份"));
    }
    let directory = root.join("generations").join(&id).join("committed");
    if !directory.join("manifest.json").is_file() {
        let old = root
            .parent()
            .unwrap_or(root)
            .join("snapshots")
            .join(format!("{id}.json"));
        if old.is_file() {
            return load_legacy(&old);
        }
        return Err(operation_error("NO_SNAPSHOT", "未找到已提交快照"));
    }
    let raw: serde_json::Value =
        serde_json::from_slice(&bounded_read(&directory.join("manifest.json"))?)
            .map_err(|_| corrupt("快照索引损坏"))?;
    if raw["schemaVersion"] != 3 {
        return Err(operation_error("UNSUPPORTED_VERSION", "不支持此快照版本"));
    }
    let manifest: Manifest =
        serde_json::from_value(raw).map_err(|e| corrupt(format!("快照索引无效：{e}")))?;
    if manifest.snapshot_ref.snapshot_id != id {
        return Err(corrupt("快照身份不匹配"));
    }
    Ok(Snapshot {
        manifest,
        directory,
        legacy_ledger: None,
        memory_turns: None,
        live_rows: None,
    })
}
impl Snapshot {
    pub(crate) fn export_live(&self) -> Result<Snapshot> {
        let prices = crate::pricing_sync::current()?;
        if prices.catalog_hash != self.manifest.price_catalog_hash {
            return Err(operation_error(
                "PRICE_CHANGED",
                "价表已经更新，请重新同步后保存",
            ));
        }
        let rows = self
            .live_rows
            .as_ref()
            .ok_or_else(|| operation_error("INVALID_ARGUMENT", "只能导出实时读取版本"))?;
        let turns = self.memory_turns.as_ref().unwrap();
        let collected = Collected {
            sources: self.manifest.sources.clone(),
            issues: self.manifest.issues.clone(),
            threads: self
                .manifest
                .threads
                .iter()
                .map(|e| e.thread.clone())
                .collect(),
            turns: self
                .manifest
                .threads
                .iter()
                .flat_map(|e| e.turns.values().filter_map(|t| t.turn.clone()))
                .collect(),
            measurements: rows.iter().map(|r| r.fact.clone()).collect(),
            operations: turns
                .values()
                .flat_map(|t| t.operations.iter().cloned())
                .collect(),
        };
        save_with_prices(&product_home()?, collected, prices)
    }
    pub(crate) fn measurement_facts(&self) -> impl Iterator<Item = &Arc<Measurement>> {
        self.live_rows
            .iter()
            .flat_map(|rows| rows.iter().map(|r| &r.fact))
    }
    pub(crate) fn live_ledger(&self) -> Option<Vec<&PricedMeasurement>> {
        self.live_rows
            .as_ref()
            .map(|rows| rows.iter().map(Arc::as_ref).collect())
    }
    pub fn ledger(&self) -> Result<Vec<PricedMeasurement>> {
        if let Some(rows) = &self.live_rows {
            return Ok(rows.iter().map(|r| r.as_ref().clone()).collect());
        }
        if let Some(rows) = &self.legacy_ledger {
            return Ok(rows.clone());
        }
        let bytes = bounded_read(&safe_file(&self.directory, &self.manifest.ledger.file)?)?;
        if crate::hash(&bytes) != self.manifest.ledger.sha256 {
            return Err(corrupt("计量分片校验失败"));
        }
        serde_json::from_slice(&bytes).map_err(|e| corrupt(format!("计量分片无效：{e}")))
    }
    pub fn turn(&self, thread_id: &str, turn_id: &str) -> Result<TurnData> {
        if let Some(turns) = &self.memory_turns {
            let turn = turns
                .get(&(thread_id.into(), turn_id.into()))
                .ok_or_else(|| operation_error("NOT_FOUND", "未找到轮次"))?;
            let rows = self.live_rows.as_ref().unwrap();
            return Ok(TurnData {
                measurements: turn
                    .measurements
                    .iter()
                    .map(|id| rows[*id].as_ref().clone())
                    .collect(),
                operations: turn
                    .operations
                    .iter()
                    .map(|op| op.as_ref().clone())
                    .collect(),
            });
        }
        let thread = self
            .manifest
            .threads
            .iter()
            .find(|t| t.thread.id == thread_id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
        if self.legacy_ledger.is_some() {
            return Err(operation_error(
                "DETAIL_UNAVAILABLE",
                "旧快照没有轮次明细，请更新用量",
            ));
        }
        let entry = thread
            .turns
            .get(turn_id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到轮次"))?;
        if entry.slice.length > MAX_FILE_BYTES {
            return Err(corrupt("轮次分片过大"));
        }
        let mut file = fs::File::open(safe_file(&self.directory, &thread.file.file)?)?;
        if entry
            .slice
            .offset
            .checked_add(entry.slice.length)
            .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
        {
            return Err(corrupt("轮次定位越界"));
        }
        file.seek(SeekFrom::Start(entry.slice.offset))?;
        let mut bytes = vec![0; entry.slice.length as usize];
        file.read_exact(&mut bytes)?;
        if crate::hash(&bytes) != entry.slice.sha256 {
            return Err(corrupt("轮次分片校验失败"));
        }
        serde_json::from_slice(&bytes).map_err(|e| corrupt(format!("轮次分片无效：{e}")))
    }
}

// serde skips legacy events/resources without materialising their bodies.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct LegacySnapshot {
    schema_version: u32,
    snapshot_id: String,
    created_at: String,
    catalog: LegacyCatalog,
    sessions: Vec<serde_json::Value>,
    usage: LegacyUsage,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct LegacyCatalog {
    sessions: Vec<serde_json::Value>,
    ledger: Vec<serde_json::Value>,
    workspaces: Vec<serde_json::Value>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct LegacyUsage {
    accounting: LegacyAccounting,
    sections: LegacySections,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct LegacyAccounting {
    records: Vec<serde_json::Value>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct LegacySections {
    session: LegacySection,
    daily: LegacySection,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct LegacySection {
    rows: Vec<serde_json::Value>,
}
fn field(v: &serde_json::Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::to_owned)
}
fn legacy_agent(v: &serde_json::Value) -> Option<String> {
    field(v, "agentKind").or_else(|| field(v, "agent"))
}
fn legacy_upstream(v: &serde_json::Value) -> Option<String> {
    let id = field(v, "upstreamSessionId")
        .or_else(|| field(v, "sessionId"))
        .or_else(|| field(v, "id"))?;
    let agent = legacy_agent(v).unwrap_or_else(|| "codex".into());
    Some(id.strip_prefix(&format!("{agent}:")).unwrap_or(&id).into())
}
fn legacy_project(session: &serde_json::Value, old: &LegacySnapshot) -> Option<String> {
    use std::collections::BTreeSet;
    if let Some(id) = session["attributionWorkspaceId"].as_str() {
        let workspaces: Vec<_> = old
            .catalog
            .workspaces
            .iter()
            .filter(|w| w["id"].as_str() == Some(id))
            .collect();
        if workspaces.len() != 1 {
            return None;
        }
        let paths: BTreeSet<_> = workspaces[0]["paths"]
            .as_array()?
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        return (paths.len() == 1).then(|| paths.first().unwrap().to_string());
    }
    if session["workspaceIds"]
        .as_array()
        .is_some_and(|ids| ids.len() > 1)
    {
        return None;
    }
    let mut paths = BTreeSet::new();
    let mut add_paths = |row: &serde_json::Value| {
        for key in ["cwd", "workspace"] {
            if let Some(path) = row[key].as_str().filter(|p| !p.is_empty()) {
                paths.insert(path.to_owned());
            }
        }
        for path in row["contextWorkspaces"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str())
        {
            paths.insert(path.to_owned());
        }
    };
    add_paths(session);
    if let Some(file) = session["sourceFile"]
        .as_str()
        .or_else(|| session["file"].as_str())
    {
        for raw in old
            .sessions
            .iter()
            .filter(|raw| raw["sourceFile"].as_str().or_else(|| raw["file"].as_str()) == Some(file))
        {
            if legacy_upstream(raw) != legacy_upstream(session)
                || legacy_agent(raw)
                    .zip(legacy_agent(session))
                    .is_some_and(|(a, b)| a != b)
            {
                return None;
            }
            add_paths(raw);
        }
    }
    (paths.len() == 1).then(|| paths.into_iter().next().unwrap())
}
fn old_token(v: &serde_json::Value, key: &str) -> Result<Option<u64>> {
    if v[key].is_null() {
        return Ok(None);
    }
    let n = v[key]
        .as_f64()
        .ok_or_else(|| corrupt("旧快照Token不是数字"))?;
    if !n.is_finite() || n < 0.0 || n.fract() != 0.0 || n > MAX_SAFE_INTEGER as f64 {
        return Err(corrupt("旧快照Token超出安全整数范围"));
    }
    Ok(Some(n as u64))
}
fn load_legacy(path: &Path) -> Result<Snapshot> {
    let file = fs::File::open(path)?;
    let old: LegacySnapshot = serde_json::from_reader(std::io::BufReader::new(file))
        .map_err(|e| corrupt(format!("旧快照无效：{e}")))?;
    if ![1, 2].contains(&old.schema_version) {
        return Err(operation_error("UNSUPPORTED_VERSION", "不支持此快照版本"));
    }
    let mut threads = Vec::new();
    let sessions = if old.catalog.sessions.is_empty() {
        &old.sessions
    } else {
        &old.catalog.sessions
    };
    let mut file_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut ownership_issues = Vec::new();
    let mut upstream_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for s in sessions {
        let Some(id) = field(s, "id").or_else(|| field(s, "sessionId")) else {
            continue;
        };
        let upstream = legacy_upstream(s).unwrap_or_else(|| id.clone());
        if let Some(file) = field(s, "sourceFile").or_else(|| field(s, "file")) {
            file_ids.entry(file).or_default().push(id.clone());
        }
        upstream_ids
            .entry(upstream.clone())
            .or_default()
            .push(id.clone());
        let thread = Thread {
            id,
            agent_kind: legacy_agent(s).unwrap_or_else(|| "codex".into()),
            source_instance_id: field(s, "instanceId")
                .or_else(|| field(s, "sourceId"))
                .unwrap_or_else(|| "legacy".into()),
            upstream_id: upstream,
            title: field(&s["title"], "text").or_else(|| field(s, "title")),
            project: legacy_project(s, &old),
            started_at: field(s, "startedAt"),
            last_activity_at: field(s, "lastActivityAt"),
        };
        threads.push(ThreadEntry {
            thread,
            file: FileRef {
                file: String::new(),
                sha256: String::new(),
            },
            turns: BTreeMap::new(),
        });
    }
    let detailed = !old.usage.accounting.records.is_empty();
    let aggregate = if !old.catalog.ledger.is_empty() {
        &old.catalog.ledger
    } else if !old.usage.sections.session.rows.is_empty() {
        &old.usage.sections.session.rows
    } else {
        &old.usage.sections.daily.rows
    };
    let rows: Vec<_> = if detailed {
        old.usage
            .accounting
            .records
            .iter()
            .map(|row| (row, true))
            .chain(
                aggregate
                    .iter()
                    .filter(|row| {
                        legacy_agent(row).is_some_and(|agent| agent != "codex" && !agent.is_empty())
                    })
                    .map(|row| (row, false)),
            )
            .collect()
    } else {
        aggregate.iter().map(|row| (row, false)).collect()
    };
    let mut records = Vec::new();
    for (index, (row, detailed_row)) in rows.iter().enumerate() {
        use std::collections::BTreeSet;
        let evidence_files: BTreeSet<_> = row["evidence"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["file"].as_str())
            .collect();
        let evidence: BTreeSet<_> = evidence_files
            .iter()
            .filter_map(|file| file_ids.get(*file))
            .flatten()
            .cloned()
            .collect();
        let source_hints: BTreeSet<_> = threads
            .iter()
            .filter(|t| evidence.contains(&t.thread.id))
            .map(|t| t.thread.source_instance_id.as_str())
            .collect();
        let explicit_owner = field(&row["responseIdentity"], "threadId");
        let native = explicit_owner.clone().or_else(|| field(row, "session"));
        let explicit_id =
            field(row, "sessionId").filter(|id| threads.iter().any(|t| t.thread.id == *id));
        let native_ids = native.as_ref().and_then(|id| upstream_ids.get(id));
        let mut candidates: BTreeSet<String> = if let Some(id) = &explicit_id {
            [id.clone()].into_iter().collect()
        } else if let Some(ids) = native_ids {
            ids.iter().cloned().collect()
        } else if explicit_owner.is_some() || (*detailed_row && native.is_some()) {
            BTreeSet::new()
        } else {
            evidence.clone()
        };
        candidates.retain(|id| {
            let thread = &threads.iter().find(|t| t.thread.id == *id).unwrap().thread;
            native.as_ref().is_none_or(|owner| {
                if explicit_owner.is_some() || *detailed_row || native_ids.is_some() {
                    &thread.upstream_id == owner
                } else {
                    true
                }
            }) && (evidence_files.is_empty()
                || (!source_hints.is_empty()
                    && source_hints.contains(thread.source_instance_id.as_str())))
                && legacy_agent(row).is_none_or(|agent| agent == thread.agent_kind)
                && field(row, "instanceId").is_none_or(|source| source == thread.source_instance_id)
        });
        let thread_id = (candidates.len() == 1).then(|| candidates.into_iter().next().unwrap());
        if thread_id.is_none()
            && (explicit_id.is_some() || explicit_owner.is_some() || !evidence.is_empty())
        {
            ownership_issues.push(Issue {
                code: "LEGACY_OWNERSHIP_UNRESOLVED".into(),
                message: "旧计量的归属证据冲突或不唯一，已保留为未关联记录".into(),
                source_instance_id: None,
                evidence: None,
            });
        }
        let linked_thread = thread_id
            .as_ref()
            .and_then(|id| threads.iter().find(|t| t.thread.id == *id))
            .map(|t| &t.thread);
        let tokens = TokenUsage {
            input: old_token(row, "inputTokens")?,
            cache_read: old_token(row, "cacheReadTokens")?,
            cache_create: old_token(row, "cacheCreationTokens")?,
            output: old_token(row, "outputTokens")?,
            reasoning: old_token(row, "reasoningTokens")?,
            total: old_token(row, "totalTokens")?,
            raw_input: old_token(row, "rawInputTokens")?,
        };
        let hidden = row["pricing"] == "hidden" || row["pricingCoverage"] == "hidden";
        let amount = if hidden {
            None
        } else {
            row.get("costUsd")
                .or_else(|| row.get("costUSD"))
                .filter(|v| v.is_number() || v.is_string())
                .map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| v.to_string())
                })
        };
        let coverage = row["pricingCoverage"]
            .as_str()
            .or_else(|| row["pricingState"].as_str())
            .or_else(|| row["pricing"].as_str());
        let unknown = hidden
            || matches!(
                coverage,
                Some("unpriced" | "unknown" | "missing" | "unavailable")
            );
        let mut price = pricing::legacy_price(if unknown { None } else { amount.as_deref() })
            .map_err(corrupt)?;
        if coverage == Some("partial") {
            price.cost = None;
            price.status = "partial".into();
            for component in &mut price.components {
                component.cost = None;
                component.status = "partial".into();
            }
        }
        let timestamp = if *detailed_row {
            field(row, "timestamp")
        } else {
            field(row, "period").or_else(|| field(row, "date"))
        };
        let model = field(row, "model").or_else(|| {
            row["models"]
                .as_array()
                .filter(|a| a.len() == 1)
                .and_then(|a| a[0].as_str().map(str::to_owned))
        });
        records.push(PricedMeasurement {
            fact: Measurement {
                id: field(row, "id").unwrap_or_else(|| format!("legacy-{index}")),
                agent_kind: linked_thread
                    .map(|t| t.agent_kind.clone())
                    .or_else(|| legacy_agent(row))
                    .unwrap_or_else(|| "codex".into()),
                source_instance_id: linked_thread
                    .map(|t| t.source_instance_id.clone())
                    .or_else(|| field(row, "instanceId"))
                    .unwrap_or_else(|| "legacy".into()),
                thread_id,
                turn_id: None,
                response_id: None,
                timestamp,
                interval_end: None,
                grain: if *detailed_row {
                    "legacy_record"
                } else {
                    "legacy_aggregate"
                }
                .into(),
                time_precision: if *detailed_row { "second" } else { "date" }.into(),
                model: ModelRef {
                    raw: model,
                    ..Default::default()
                },
                reasoning_effort: None,
                tokens,
                request_scoped: false,
                reported_cost: None,
                service_tier: None,
                sequence: index as u64,
                evidence: vec![],
            }
            .into(),
            price,
        });
    }
    let issue = Issue {
        code: "LEGACY_DETAILS_UNAVAILABLE".into(),
        message: "旧快照保留原金额口径；更新用量后可查看轮次".into(),
        source_instance_id: None,
        evidence: None,
    };
    let manifest = Manifest {
        schema_version: old.schema_version,
        snapshot_ref: SnapshotRef {
            snapshot_id: old.snapshot_id,
            created_at: old.created_at,
            selector: Some(crate::absolute(path)?.to_string_lossy().into_owned()),
        },
        price_revision: "legacy".into(),
        price_catalog_hash: String::new(),
        sources: vec![],
        issues: {
            ownership_issues.push(issue);
            ownership_issues
        },
        ledger: FileRef {
            file: String::new(),
            sha256: String::new(),
        },
        threads,
    };
    Ok(Snapshot {
        manifest,
        directory: path.parent().unwrap_or(Path::new(".")).to_owned(),
        legacy_ledger: Some(records),
        memory_turns: None,
        live_rows: None,
    })
}

/// Revisions share unchanged priced facts; details store IDs instead of a second ledger.
pub(crate) fn memory(
    collected: Collected,
    id: String,
    prices: crate::pricing_sync::Response,
    prior: Option<&Snapshot>,
) -> Result<Snapshot> {
    let reusable = prior
        .filter(|s| s.manifest.price_catalog_hash == prices.catalog_hash)
        .and_then(|s| s.live_rows.as_ref());
    let mut rows = Vec::with_capacity(collected.measurements.len());
    let mut memory_turns: BTreeMap<(String, String), MemoryTurn> = BTreeMap::new();
    for fact in collected.measurements {
        let prior = reusable
            .and_then(|rows| {
                rows.binary_search_by(|r| r.fact.id.cmp(&fact.id))
                    .ok()
                    .map(|i| &rows[i])
            })
            .filter(|r| r.fact == fact);
        let row = match prior {
            Some(row) => Arc::clone(row),
            None => {
                let price = pricing::price_with_catalog(
                    &fact.model,
                    &fact.tokens,
                    &PricingContext {
                        request_scoped: fact.request_scoped,
                    },
                    &prices.catalog,
                    &prices.catalog_hash,
                );
                Arc::new(PricedMeasurement { fact, price })
            }
        };
        rows.push(row);
    }
    rows.sort_unstable_by(|a, b| a.fact.id.cmp(&b.fact.id));
    for (index, row) in rows.iter().enumerate() {
        if let Some(thread) = &row.fact.thread_id {
            memory_turns
                .entry((
                    thread.clone(),
                    row.fact
                        .turn_id
                        .clone()
                        .unwrap_or_else(|| "unassigned".into()),
                ))
                .or_default()
                .measurements
                .push(index);
        }
    }
    crate::usage_app::summarize(&rows.iter().map(Arc::as_ref).collect::<Vec<_>>())?;
    for op in collected.operations {
        memory_turns
            .entry((
                op.thread_id.clone(),
                op.turn_id.clone().unwrap_or_else(|| "unassigned".into()),
            ))
            .or_default()
            .operations
            .push(op);
    }
    let turns: BTreeMap<_, _> = collected
        .turns
        .into_iter()
        .map(|t| ((t.thread_id.clone(), t.id.clone()), t))
        .collect();
    for key in turns.keys() {
        memory_turns.entry(key.clone()).or_default();
    }
    let mut by_thread: BTreeMap<String, BTreeMap<String, TurnEntry>> = BTreeMap::new();
    for (thread, turn) in memory_turns.keys() {
        by_thread.entry(thread.clone()).or_default().insert(
            turn.clone(),
            TurnEntry {
                turn: turns.get(&(thread.clone(), turn.clone())).cloned(),
                slice: Slice {
                    offset: 0,
                    length: 0,
                    sha256: String::new(),
                },
            },
        );
    }
    let threads = collected
        .threads
        .into_iter()
        .map(|thread| {
            let turns = by_thread.remove(&thread.id).unwrap_or_default();
            ThreadEntry {
                thread,
                turns,
                file: file_ref("live", &[]),
            }
        })
        .collect();
    if !by_thread.is_empty() {
        return Err(operation_error("INVALID_FACTS", "存在没有对话元数据的记录"));
    }
    let manifest = Manifest {
        schema_version: 3,
        snapshot_ref: SnapshotRef {
            snapshot_id: id,
            created_at: chrono::Utc::now().to_rfc3339(),
            selector: None,
        },
        price_revision: prices.catalog.revision,
        price_catalog_hash: prices.catalog_hash,
        sources: collected.sources,
        issues: collected.issues,
        ledger: file_ref("live", &[]),
        threads,
    };
    Ok(Snapshot {
        manifest,
        directory: PathBuf::new(),
        legacy_ledger: None,
        live_rows: Some(rows),
        memory_turns: Some(memory_turns),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Collected {
        let thread = Thread {
            id: "thread-a".into(),
            agent_kind: "test".into(),
            source_instance_id: "source-a".into(),
            upstream_id: "a".into(),
            title: Some("synthetic".into()),
            project: None,
            started_at: None,
            last_activity_at: None,
        };
        let turn = Turn {
            id: "turn-a".into(),
            thread_id: thread.id.clone(),
            upstream_id: "a".into(),
            ordinal: 1,
            started_at: None,
            ended_at: None,
            status: "completed".into(),
        };
        let record = Measurement {
            id: "measurement-a".into(),
            agent_kind: "test".into(),
            source_instance_id: "source-a".into(),
            thread_id: Some(thread.id.clone()),
            turn_id: Some(turn.id.clone()),
            response_id: None,
            timestamp: Some("2026-09-29T01:00:00Z".into()),
            interval_end: None,
            grain: "response".into(),
            time_precision: "second".into(),
            model: ModelRef {
                raw: Some("gpt-5.3-codex".into()),
                provider: Some("openai".into()),
                api_provider: Some("openai".into()),
                pricing_model: None,
            },
            reasoning_effort: None,
            tokens: TokenUsage {
                input: Some(100),
                cache_read: Some(0),
                cache_create: Some(0),
                output: Some(10),
                reasoning: None,
                total: Some(110),
                raw_input: Some(100),
            },
            request_scoped: true,
            reported_cost: None,
            service_tier: None,
            sequence: 1,
            evidence: vec![],
        };
        Collected {
            threads: vec![thread],
            turns: vec![turn],
            measurements: vec![record.into()],
            ..Default::default()
        }
    }
    #[test]
    fn immutable_generation_and_exact_turn_read() {
        let root = tempfile::tempdir().unwrap();
        let old = save_at(root.path(), fixture()).unwrap();
        let old_id = old.manifest.snapshot_ref.snapshot_id.clone();
        let next = save_at(root.path(), Collected::default()).unwrap();
        assert_ne!(old_id, next.manifest.snapshot_ref.snapshot_id);
        assert_eq!(
            load_at(root.path(), Some(&old_id))
                .unwrap()
                .ledger()
                .unwrap()[0]
                .fact
                .tokens
                .total,
            Some(110)
        );
        assert_eq!(
            load_at(root.path(), None)
                .unwrap()
                .manifest
                .snapshot_ref
                .snapshot_id,
            next.manifest.snapshot_ref.snapshot_id
        );
        let turn = old.turn("thread-a", "turn-a").unwrap();
        assert_eq!(turn.measurements.len(), 1);
        // A target-turn read does not access the global ledger.
        fs::remove_file(old.directory.join("ledger.json")).unwrap();
        assert_eq!(
            old.turn("thread-a", "turn-a").unwrap().measurements[0]
                .fact
                .id,
            "measurement-a"
        );
        assert!(old.ledger().is_err());
    }
    #[test]
    fn corruption_uncommitted_and_refresh_busy_are_detected() {
        let root = tempfile::tempdir().unwrap();
        let lock = RefreshLock::at(root.path()).unwrap();
        assert!(RefreshLock::at(root.path()).is_err());
        drop(lock);
        assert!(RefreshLock::at(root.path()).is_ok());
        let snapshot = save_at(root.path(), fixture()).unwrap();
        let latest = fs::read(root.path().join("latest.json")).unwrap();
        private_dir(&root.path().join("generations/uncommitted/.pending-a")).unwrap();
        assert!(load_at(root.path(), Some("uncommitted")).is_err());
        assert_eq!(fs::read(root.path().join("latest.json")).unwrap(), latest);
        let path = snapshot
            .directory
            .join(&snapshot.manifest.threads[0].file.file);
        fs::write(path, b"{}").unwrap();
        assert!(snapshot.turn("thread-a", "turn-a").is_err());
    }
    #[test]
    fn legacy_metadata_no_body_no_reprice_no_write() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("old.json");
        let old = serde_json::json!({"schemaVersion":2,"snapshotId":"old","createdAt":"2026-09-28T00:00:00Z","events":[{"body":"PRIVATE_SENTINEL"}],"catalog":{"sessions":[{"id":"keep-id","upstreamSessionId":"upstream","sourceFile":"/synthetic/log"}],"ledger":[{"id":"old-row","sessionId":"keep-id","totalTokens":11,"costUsd":1.2345,"pricingCoverage":"partial"}]}});
        let bytes = serde_json::to_vec(&old).unwrap();
        fs::write(&path, &bytes).unwrap();
        let loaded = load_legacy(&path).unwrap();
        let records = loaded.ledger().unwrap();
        assert_eq!(records[0].price.policy, "legacy_recorded");
        assert_eq!(records[0].price.cost, None);
        assert_eq!(records[0].price.known_cost, "1.2345");
        assert!(
            !serde_json::to_string(&records)
                .unwrap()
                .contains("PRIVATE_SENTINEL")
        );
        assert_eq!(loaded.manifest.threads[0].thread.id, "keep-id");
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert!(loaded.turn("keep-id", "anything").is_err());
    }

    #[test]
    fn legacy_detailed_records_keep_thread_source_and_exact_raw_project_for_filters() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("old.json");
        let old = serde_json::json!({"schemaVersion":2,"snapshotId":"old","createdAt":"2026-09-29T00:00:00Z",
            "sessions":[{"id":"codex:native","agent":"codex","workspace":"/synthetic/project","sourceFile":"/synthetic/log"}],
            "catalog":{"sessions":[{"id":"ses-old","upstreamSessionId":"native","agentKind":"codex","instanceId":"inst-old","sourceFile":"/synthetic/log"}]},
            "usage":{"accounting":{"records":[{"id":"r","session":"native","timestamp":"2026-09-29T00:00:00Z","totalTokens":110,"costUSD":1,"pricingState":"priced","evidence":[{"file":"/synthetic/log","line":1}]}]}}});
        let bytes = serde_json::to_vec(&old).unwrap();
        fs::write(&path, &bytes).unwrap();
        let loaded = load_legacy(&path).unwrap();
        let rows = loaded.ledger().unwrap();
        assert_eq!(rows[0].fact.thread_id.as_deref(), Some("ses-old"));
        assert_eq!(rows[0].fact.source_instance_id, "inst-old");
        assert_eq!(
            loaded.manifest.threads[0].thread.project.as_deref(),
            Some("/synthetic/project")
        );
        for scope in [
            serde_json::json!({"sourceInstanceId":"inst-old"}),
            serde_json::json!({"project":"/synthetic/project"}),
        ] {
            let request = serde_json::from_value(
                serde_json::json!({"action":"threads","snapshotId":path,"scope":scope}),
            )
            .unwrap();
            let result = crate::usage_app::execute(request).unwrap();
            assert_eq!(result.summary.tokens.total, Some(110));
            assert_eq!(result.summary.price.policy, "legacy_recorded");
            assert_eq!(result.items.len(), 1);
        }
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn legacy_explicit_owner_uses_evidence_source_namespace_and_rejects_conflicting_identity() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("old.json");
        let record = |id: &str, owner: &str, session: Option<&str>| serde_json::json!({"id":id,"responseIdentity":{"threadId":owner},"sessionId":session,"timestamp":"2026-09-29T00:00:00Z","totalTokens":110,"evidence":[{"file":"/synthetic/child","line":1}]});
        let old = serde_json::json!({"schemaVersion":2,"snapshotId":"old","catalog":{"sessions":[
            {"id":"parent-a","upstreamSessionId":"parent","agentKind":"codex","instanceId":"source-a","sourceFile":"/synthetic/parent-a"},
            {"id":"parent-b","upstreamSessionId":"parent","agentKind":"codex","instanceId":"source-b","sourceFile":"/synthetic/parent-b"},
            {"id":"child-a","upstreamSessionId":"child","agentKind":"codex","instanceId":"source-a","sourceFile":"/synthetic/child"}]},
            "usage":{"accounting":{"records":[record("good","parent",None),record("missing","not-recorded",None),record("conflict","parent",Some("child-a"))]}}});
        fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let loaded = load_legacy(&path).unwrap();
        let rows = loaded.ledger().unwrap();
        assert_eq!(rows[0].fact.thread_id.as_deref(), Some("parent-a"));
        assert_eq!(rows[0].fact.source_instance_id, "source-a");
        assert!(rows[1].fact.thread_id.is_none());
        assert!(rows[2].fact.thread_id.is_none());
        assert_eq!(
            rows.iter()
                .map(|r| r.fact.tokens.total.unwrap())
                .sum::<u64>(),
            330
        );
        assert_eq!(
            loaded
                .manifest
                .issues
                .iter()
                .filter(|i| i.code == "LEGACY_OWNERSHIP_UNRESOLVED")
                .count(),
            2
        );
    }

    #[test]
    fn legacy_project_uses_explicit_attribution_and_never_picks_from_multiple_paths() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("old.json");
        let old = serde_json::json!({"schemaVersion":2,"snapshotId":"old","sessions":[
            {"id":"codex:multi","agent":"codex","workspace":"/synthetic/startup","sourceFile":"/synthetic/multi"}],
            "catalog":{"sessions":[
                {"id":"single","upstreamSessionId":"one","attributionWorkspaceId":"ws-one","workspaceIds":["ws-one"]},
                {"id":"multiple","upstreamSessionId":"multi","sourceFile":"/synthetic/multi","attributionWorkspaceId":"ws-many","workspaceIds":["ws-many"]}],
                "workspaces":[{"id":"ws-one","paths":["/synthetic/one"]},{"id":"ws-many","paths":["/synthetic/a","/synthetic/b"]}]}});
        fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let loaded = load_legacy(&path).unwrap();
        assert_eq!(
            loaded.manifest.threads[0].thread.project.as_deref(),
            Some("/synthetic/one")
        );
        assert!(loaded.manifest.threads[1].thread.project.is_none());
    }

    #[test]
    fn legacy_codex_detail_keeps_other_agent_aggregate_without_double_counting_codex() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("old.json");
        let old = serde_json::json!({"schemaVersion":2,"snapshotId":"old","catalog":{"sessions":[
            {"id":"claude-thread","upstreamSessionId":"claude-native","agentKind":"claude","instanceId":"claude-source"}],
            "ledger":[{"id":"duplicate-codex","agentKind":"codex","totalTokens":110,"costUsd":1},
                {"id":"claude-row","agentKind":"claude","sessionId":"claude-thread","totalTokens":20,"costUsd":2}]},
            "usage":{"accounting":{"records":[{"id":"codex-direct","agent":"codex","totalTokens":110,"costUSD":1}]}}});
        fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let loaded = load_legacy(&path).unwrap();
        let rows = loaded.ledger().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(!rows.iter().any(|r| r.fact.id == "duplicate-codex"));
        assert_eq!(rows[1].fact.agent_kind, "claude");
        assert_eq!(rows[1].fact.source_instance_id, "claude-source");
        assert_eq!(rows[1].fact.grain, "legacy_aggregate");
        assert!(rows[1].fact.turn_id.is_none());
        let sum = crate::usage_app::summarize(&rows.iter().collect::<Vec<_>>()).unwrap();
        assert_eq!(sum.tokens.total, Some(130));
        assert_eq!(sum.price.cost.as_deref(), Some("3"));
        assert_eq!(sum.price.policy, "legacy_recorded");
    }
}
