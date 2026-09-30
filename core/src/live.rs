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
    pub checked_at: Option<String>,
    pub revision: String,
    pub error: Option<String>,
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
    touched: Instant,
    syncing: bool,
    last_sync: Instant,
    following: bool,
    requested: u64,
    completed: u64,
}
impl Entry {
    fn new(roots: Vec<String>) -> Self {
        Self {
            roots,
            views: VecDeque::new(),
            attempt: 0,
            checked: None,
            error: None,
            touched: Instant::now(),
            syncing: false,
            last_sync: Instant::now(),
            following: false,
            requested: 0,
            completed: 0,
        }
    }
}
type Shared = Arc<(Mutex<BTreeMap<String, Entry>>, Condvar)>;
struct Job {
    ticket: u64,
    key: String,
    verify: bool,
}

fn directory() -> Result<PathBuf> {
    let path = crate::storage::data_home()?.join("live-v1");
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
fn sources(roots: &[String]) -> DiscoveryReport {
    adapters::codex::CodexAdapter.discover(&DiscoveryRequest {
        roots: roots.iter().map(PathBuf::from).collect(),
    })
}
fn source_key(roots: &[String]) -> String {
    let mut ids: Vec<_> = sources(roots).sources.into_iter().map(|s| s.id).collect();
    ids.sort();
    crate::hash(ids.join(":"))
}
fn load_collected(db: &rusqlite::Connection, key: &str) -> Result<Option<Collected>> {
    let mut value = Collected::default();
    let found = crate::live_index::each(db, &format!("projection:{key}"), |field, id, payload| {
        macro_rules! rows {
            ($name:ident) => {
                if id.is_empty() {
                    value.$name.extend(serde_json::from_str::<Vec<_>>(payload)?);
                } else {
                    value.$name.push(serde_json::from_str(payload)?);
                }
            };
        }
        match field {
            "sources" => {
                rows!(sources);
            }
            "threads" => {
                rows!(threads);
            }
            "turns" => {
                rows!(turns);
            }
            "measurements" => {
                rows!(measurements);
            }
            "operations" => {
                rows!(operations);
            }
            "issues" => {
                value.issues = serde_json::from_str(payload)?;
            }
            _ => anyhow::bail!("unsupported projection field: {field}"),
        }
        Ok(())
    })?;
    Ok(found.then_some(value))
}

fn sync(
    db: &mut rusqlite::Connection,
    key: &str,
    roots: &[String],
    verify: bool,
    prior_view: Option<&Snapshot>,
    caches: &mut BTreeMap<String, adapters::codex::incremental::Cache>,
) -> Result<Option<Arc<Snapshot>>> {
    let discovered = sources(roots);
    if !discovered.issues.is_empty()
        && !discovered
            .sources
            .iter()
            .any(|s| std::path::Path::new(&s.root).is_dir())
    {
        return Err(operation_error(
            "SOURCE_UNREADABLE",
            "指定的日志来源不可读取，保留已提交数据",
        ));
    }
    let tx = db.transaction()?;
    let mut changed = false;
    let mut epochs = BTreeMap::new();
    let mut updated = BTreeMap::new();
    for source in &discovered.sources {
        if let Some((value, dirty_operations)) = adapters::codex::incremental::sync_cached(
            &tx,
            source,
            verify,
            caches.entry(source.id.clone()).or_default(),
        )? {
            let scope = format!("projection:{}", source.id);
            crate::live_index::replace_field(
                &tx,
                &scope,
                "sources",
                value.sources.iter().map(|s| (s.source.id.as_str(), s)),
            )?;
            macro_rules! save {
                ($field:ident) => {
                    crate::live_index::replace_field(
                        &tx,
                        &scope,
                        stringify!($field),
                        value.$field.iter().map(|v| (v.id.as_str(), v)),
                    )?;
                };
            }
            save!(threads);
            save!(turns);
            save!(measurements);
            crate::live_index::put(&tx, &scope, "issues", "", &value.issues)?;
            if let Some(dirty) = dirty_operations {
                for operation in &value.operations {
                    if dirty.contains(&operation.id) {
                        crate::live_index::put(
                            &tx,
                            &scope,
                            "operations",
                            &operation.id,
                            operation,
                        )?;
                    }
                }
            } else {
                save!(operations);
            }
            updated.insert(source.id.clone(), value);
            crate::live_index::save_map(
                &tx,
                &format!("epoch:{}", source.id),
                json!({"id":uuid::Uuid::new_v4().to_string()})
                    .as_object()
                    .unwrap(),
            )?;
            changed = true;
        }
        epochs.insert(
            source.id.clone(),
            crate::live_index::load_map(&tx, &format!("epoch:{}", source.id))?,
        );
    }
    let prices = crate::pricing_sync::current()?;
    let prior = crate::live_index::load_map(&tx, &format!("view:{key}"))?;
    changed |= prior.get("epochs") != Some(&serde_json::to_value(&epochs)?);
    changed |= prior.get("prices").and_then(Value::as_str) != Some(&prices.catalog_hash);
    if !changed {
        tx.commit()?;
        return Ok(None);
    }
    let mut collected = Collected {
        issues: discovered.issues,
        ..Collected::default()
    };
    for source in &discovered.sources {
        let value = match updated.remove(&source.id) {
            Some(value) => value,
            None => load_collected(&tx, &source.id)?.unwrap_or_default(),
        };
        collected.sources.extend(value.sources);
        collected.issues.extend(value.issues);
        collected.threads.extend(value.threads);
        collected.turns.extend(value.turns);
        collected.measurements.extend(value.measurements);
        collected.operations.extend(value.operations);
    }
    if collected.sources.iter().any(|s| s.status == "failed")
        && !collected
            .sources
            .iter()
            .any(|s| matches!(s.status.as_str(), "complete" | "partial"))
    {
        return Err(operation_error(
            "SOURCE_UNREADABLE",
            "没有可读取的来源，保留已提交数据",
        ));
    }
    let id = format!("live:{key}:{}", uuid::Uuid::new_v4());
    let snapshot = Arc::new(crate::usage_store::memory(
        collected,
        id.clone(),
        prices.clone(),
        prior_view,
    )?);
    for source in &discovered.sources {
        if let Some(cache) = caches.get_mut(&source.id) {
            cache.share_measurements(snapshot.measurement_facts());
        }
    }
    crate::live_index::save_map(
        &tx,
        &format!("view:{key}"),
        json!({"id": id,"prices":prices.catalog_hash,"epochs":epochs,"createdAt":snapshot.manifest.snapshot_ref.created_at})
            .as_object()
            .unwrap(),
    )?;
    tx.commit()?;
    Ok(Some(snapshot))
}
fn restore(
    db: &rusqlite::Connection,
    key: &str,
    roots: &[String],
) -> Result<Option<Arc<Snapshot>>> {
    let prior = crate::live_index::load_map(db, &format!("view:{key}"))?;
    let Some(id) = prior.get("id").and_then(Value::as_str) else {
        return Ok(None);
    };
    let prices = crate::pricing_sync::current()?;
    // A changed catalog is committed by sync before it is advertised as this revision.
    if prior.get("prices").and_then(Value::as_str) != Some(&prices.catalog_hash) {
        return Ok(None);
    }
    let mut collected = Collected::default();
    for source in sources(roots).sources {
        let epoch = crate::live_index::load_map(db, &format!("epoch:{}", source.id))?;
        if prior.get("epochs").and_then(|v| v.get(&source.id)) != Some(&Value::Object(epoch)) {
            return Ok(None);
        }
        let Some(v) = load_collected(db, &source.id)? else {
            return Ok(None);
        };
        collected.sources.extend(v.sources);
        collected.issues.extend(v.issues);
        collected.threads.extend(v.threads);
        collected.turns.extend(v.turns);
        collected.measurements.extend(v.measurements);
        collected.operations.extend(v.operations);
    }
    let mut snapshot = crate::usage_store::memory(collected, id.into(), prices, None)?;
    if let Some(at) = prior.get("createdAt").and_then(Value::as_str) {
        snapshot.manifest.snapshot_ref.created_at = at.into();
    }
    Ok(Some(Arc::new(snapshot)))
}
fn query(request: Request, shared: &Shared, jobs: &mpsc::SyncSender<Job>) -> Result<Response> {
    let mut validation = request.query.clone();
    validation.roots = None;
    crate::usage_app::validate(&validation)?;
    if request.verify && request.query.action != usage_app_dto::Action::Refresh
        || request.mode == Mode::Cached && request.query.action == usage_app_dto::Action::Refresh
    {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "实时同步选项与操作不匹配",
        ));
    }
    let roots = request.query.roots.clone().unwrap_or_default();
    let selector = request.query.snapshot_id.clone();
    if selector.as_deref().is_some_and(|s| !s.starts_with("live:")) {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "固定快照请通过快照查询接口读取",
        ));
    }
    let key = selector
        .as_deref()
        .and_then(|s| s.split(':').nth(1))
        .map(str::to_owned)
        .unwrap_or_else(|| source_key(&roots));
    let (lock, wake) = &**shared;
    let mut entries = lock.lock().unwrap();
    let entry = entries
        .entry(key.clone())
        .or_insert_with(|| Entry::new(roots));
    entry.touched = Instant::now();
    entry.requested += 1;
    let ticket = entry.requested;
    if selector.is_none() && request.mode != Mode::Cached {
        entry.syncing = true;
        entry.following = true;
        jobs.try_send(Job {
            ticket,
            key: key.clone(),
            verify: request.verify,
        })
        .map_err(|_| operation_error("UPDATE_BUSY", "同步请求队列已满，请稍后重试"))?;
        let deadline = Instant::now()
            + Duration::from_secs(
                if request.mode == Mode::Fresh
                    || request.query.action == usage_app_dto::Action::Refresh
                {
                    10
                } else {
                    2
                },
            );
        while entries[&key].completed < ticket && Instant::now() < deadline {
            let wait = deadline.saturating_duration_since(Instant::now());
            entries = wake.wait_timeout(entries, wait).unwrap().0;
        }
    } else if selector.is_none() && entry.views.is_empty() {
        // Cached reads restore the last committed index without scanning source files.
        let db = crate::live_index::open(&directory()?.join("index.sqlite"))?;
        if let Some(view) = restore(&db, &key, &entry.roots)? {
            entry.views.push_back((Instant::now(), view));
        }
    }
    let entry = entries.get_mut(&key).unwrap();
    let current = entry.completed >= ticket && entry.error.is_none() && !entry.syncing;
    if (request.mode == Mode::Fresh || request.query.action == usage_app_dto::Action::Refresh)
        && !current
        && selector.is_none()
    {
        return Err(operation_error(
            if entry.error.is_some() {
                "SOURCE_UNREADABLE"
            } else {
                "SYNC_TIMEOUT"
            },
            "未能在限定时间内完成同步，请重试或使用 --cached",
        ));
    }
    let snapshot = if let Some(selector) = &selector {
        entry
            .views
            .iter()
            .find(|(_, v)| &v.manifest.snapshot_ref.snapshot_id == selector)
            .map(|(_, v)| Arc::clone(v))
            .ok_or_else(|| {
                operation_error("VIEW_EXPIRED", "这个实时读取版本已过期，请重新打开列表")
            })?
    } else {
        entry
            .views
            .back()
            .map(|(_, v)| Arc::clone(v))
            .ok_or_else(|| {
                operation_error(
                    if request.mode == Mode::Cached {
                        "NO_SNAPSHOT"
                    } else if entry.error.is_some() {
                        "SOURCE_UNREADABLE"
                    } else {
                        "SYNC_PENDING"
                    },
                    if request.mode == Mode::Cached {
                        "尚无可读取的已提交索引，请先同步".into()
                    } else {
                        entry
                            .error
                            .clone()
                            .unwrap_or_else(|| "尚无已提交数据，同步正在进行，请稍后重试".into())
                    },
                )
            })?
    };
    let freshness = Freshness {
        status: if selector.is_some() {
            "fixed"
        } else if current {
            "current"
        } else if entry.error.is_some() {
            "failed"
        } else if entry.syncing {
            "syncing"
        } else {
            "stale"
        }
        .into(),
        checked_at: entry.checked.clone(),
        revision: snapshot.manifest.snapshot_ref.snapshot_id.clone(),
        error: entry.error.clone(),
    };
    drop(entries);
    let mut query = request.query;
    query.roots = None;
    query.snapshot_id = None;
    let mut result = if query.action == usage_app_dto::Action::Refresh {
        // Export only on an explicit refresh. Automatic updates never create snapshots.
        let _lock = crate::usage_store::RefreshLock::acquire()?;
        let saved = snapshot.export_live()?;
        query.action = usage_app_dto::Action::Usage;
        let mut result = crate::usage_app::execute_snapshot(query, &saved)?;
        result.summary = crate::usage_app::summarize(&saved.ledger()?.iter().collect::<Vec<_>>())?;
        result.scope = usage_app_dto::Scope::default();
        result.action = usage_app_dto::Action::Refresh;
        result.items.clear();
        result.page.total = 0;
        result.page.next_offset = None;
        result
    } else {
        crate::usage_app::execute_snapshot(query, &snapshot)?
    };
    result.freshness = Some(freshness.clone());
    Ok(Response {
        output_version: 1,
        result,
        freshness,
    })
}
#[cfg(unix)]
pub fn serve() -> Result<()> {
    use notify::Watcher;
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::{
        fs::{OpenOptionsExt, PermissionsExt},
        net::UnixListener,
    };
    let root = directory()?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(root.join("service.lock"))?;
    if lock.try_lock().is_err() {
        return Ok(());
    }
    let socket = socket_path()?;
    match fs::remove_file(&socket) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(&socket)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let shared: Shared = Arc::new((Mutex::new(BTreeMap::new()), Condvar::new()));
    let (jobs, receiver) = mpsc::sync_channel::<Job>(32);
    let worker_state = Arc::clone(&shared);
    let (dirty_tx, dirty_rx) = mpsc::sync_channel::<()>(1);
    let mut watcher = notify::recommended_watcher(move |_| {
        let _ = dirty_tx.try_send(());
    })?;
    let worker = std::thread::spawn(move || -> Result<()> {
        let mut db = crate::live_index::open(&root.join("index.sqlite"))?;
        let mut watched = std::collections::BTreeSet::new();
        let mut caches = BTreeMap::new();
        loop {
            let job = match receiver.recv_timeout(Duration::from_millis(500)) {
                Ok(job) => Some(job),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(_) => None,
            };
            let dirty = dirty_rx.try_recv().is_ok();
            let work: Vec<_> = {
                let entries = worker_state.0.lock().unwrap();
                entries
                    .iter()
                    .filter(|(key, e)| {
                        job.as_ref().is_some_and(|j| &j.key == *key)
                            || e.following
                                && e.touched.elapsed() < Duration::from_secs(15)
                                && (dirty
                                    || e.checked.is_none()
                                    || !e.syncing
                                        && e.views.back().is_some_and(|_| {
                                            e.last_sync.elapsed() > Duration::from_secs(2)
                                        }))
                    })
                    .map(|(key, e)| {
                        (
                            key.clone(),
                            e.roots.clone(),
                            job.as_ref().is_some_and(|j| j.key == *key && j.verify),
                        )
                    })
                    .collect()
            };
            for (key, roots, verify) in work {
                for source in sources(&roots).sources {
                    if watched.insert(source.root.clone()) {
                        let _ = watcher.watch(
                            std::path::Path::new(&source.root),
                            notify::RecursiveMode::Recursive,
                        );
                    }
                }
                let needs_restore = {
                    let mut entries = worker_state.0.lock().unwrap();
                    let entry = entries.get_mut(&key).unwrap();
                    entry.syncing = true;
                    entry.views.is_empty()
                };
                // Source restoration can be large; never hold the query-state lock across I/O.
                if needs_restore && let Ok(Some(view)) = restore(&db, &key, &roots) {
                    let mut entries = worker_state.0.lock().unwrap();
                    let entry = entries.get_mut(&key).unwrap();
                    if entry.views.is_empty() {
                        entry.views.push_back((Instant::now(), view));
                    }
                    worker_state.1.notify_all();
                }
                let prior_view = worker_state.0.lock().unwrap()[&key]
                    .views
                    .back()
                    .map(|(_, v)| Arc::clone(v));
                let outcome = sync(
                    &mut db,
                    &key,
                    &roots,
                    verify,
                    prior_view.as_deref(),
                    &mut caches,
                );
                if outcome.is_err() {
                    caches.clear();
                }
                let mut entries = worker_state.0.lock().unwrap();
                let entry = entries.get_mut(&key).unwrap();
                entry.attempt += 1;
                entry.last_sync = Instant::now();
                if let Some(job) = &job
                    && job.key == key
                {
                    entry.completed = job.ticket;
                }
                entry.syncing = false;
                match outcome {
                    Ok(view) => {
                        if let Some(view) = view {
                            entry.views.push_back((Instant::now(), view));
                        }
                        entry.checked = Some(chrono::Utc::now().to_rfc3339());
                        entry.error = None;
                    }
                    Err(e) => entry.error = Some(format!("{e:#}")),
                }
                while entry.views.len() > 1
                    && entry.views.front().is_some_and(|(t, _)| {
                        t.elapsed() > Duration::from_secs(600) || entry.views.len() > 8
                    })
                {
                    entry.views.pop_front();
                }
                worker_state.1.notify_all();
            }
        }
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        Ok(())
    });
    let mut last_client = Instant::now();
    let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                last_client = Instant::now();
                if active.load(std::sync::atomic::Ordering::Relaxed) >= 8 {
                    continue;
                }
                active.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let active = Arc::clone(&active);
                let state = Arc::clone(&shared);
                let jobs = jobs.clone();
                std::thread::spawn(move || {
                    let result = (|| -> Result<Value> {
                        stream.set_nonblocking(false)?;
                        stream.set_read_timeout(Some(Duration::from_secs(12)))?;
                        stream.set_write_timeout(Some(Duration::from_secs(12)))?;
                        let mut input = String::new();
                        use std::io::Read;
                        BufReader::new(&stream)
                            .take(1024 * 1024 + 1)
                            .read_line(&mut input)?;
                        if input.len() > 1024 * 1024 {
                            return Err(operation_error("RESOURCE_LIMIT", "请求过大"));
                        }
                        let request: Request = serde_json::from_str(&input)
                            .map_err(|_| operation_error("INVALID_ARGUMENT", "实时查询参数无效"))?;
                        Ok(serde_json::to_value(query(request, &state, &jobs)?)?)
                    })();
                    let response = match result {
                        Ok(value) => json!({"ok":true,"value":value}),
                        Err(e) => {
                            json!({"ok":false,"code":e.downcast_ref::<crate::dto::OperationError>().map_or("CORE_ERROR",|e|e.code),"error":format!("{e:#}")})
                        }
                    };
                    if let Ok(bytes) = serde_json::to_vec(&response) {
                        let _ = stream.write_all(&bytes);
                    }
                    let _ = stream.write_all(b"\n");
                    active.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if last_client.elapsed() > Duration::from_secs(15)
                    && active.load(std::sync::atomic::Ordering::Relaxed) == 0
                    && !shared.0.lock().unwrap().values().any(|e| e.syncing)
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(e.into()),
        }
    }
    drop(jobs);
    let _ = worker.join();
    let _ = fs::remove_file(socket);
    Ok(())
}
#[cfg(not(unix))]
pub fn serve() -> Result<()> {
    Err(operation_error(
        "UNSUPPORTED_PLATFORM",
        "此平台的实时用量接口尚未提供",
    ))
}
