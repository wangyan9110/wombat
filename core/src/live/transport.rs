//! Local service transport, bounded requests and connection lifecycle.
use super::*;
pub fn serve() -> Result<()> {
    #[cfg(windows)]
    use crate::live_windows::Listener as UnixListener;
    use notify::Watcher;
    use std::io::{BufRead, BufReader, Write};
    #[cfg(unix)]
    use std::os::unix::{
        fs::{OpenOptionsExt, PermissionsExt},
        net::UnixListener,
    };
    let root = directory()?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    options.mode(0o600);
    let lock = options.open(root.join("service.lock"))?;
    if lock.try_lock().is_err() {
        return Ok(());
    }
    let socket = socket_path()?;
    #[cfg(unix)]
    match fs::remove_file(&socket) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let listener = UnixListener::bind(&socket)?;
    #[cfg(unix)]
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let configs = Arc::new(Mutex::new(crate::config::Store::default()));
    let shared: Shared = Arc::new((Mutex::new(BTreeMap::new()), Condvar::new()));
    let (jobs, receiver) = mpsc::sync_channel::<Job>(32);
    let worker_state = Arc::clone(&shared);
    let (dirty_tx, dirty_rx) = mpsc::sync_channel::<()>(1);
    let mut watcher = notify::recommended_watcher(move |_| {
        let _ = dirty_tx.try_send(());
    })?;
    let worker = std::thread::spawn(move || -> Result<()> {
        let mut db = crate::live_index::open(&root.join("index.sqlite")).ok();
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
                if db.is_none() {
                    match crate::live_index::open(&root.join("index.sqlite")) {
                        Ok(opened) => db = Some(opened),
                        Err(error) => {
                            let mut entries = worker_state.0.lock().unwrap();
                            let entry = entries.get_mut(&key).unwrap();
                            entry.error_code = Some(crate::live_index::failure_code(&error));
                            entry.error = Some(error.to_string());
                            entry.last_sync = Instant::now();
                            entry.syncing = false;
                            entry.checked = Some(chrono::Utc::now().to_rfc3339());
                            if let Some(job) = &job
                                && job.key == key
                            {
                                entry.completed = job.ticket;
                            }
                            worker_state.1.notify_all();
                            continue;
                        }
                    }
                }
                let db = db.as_mut().unwrap();
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
                if needs_restore && let Ok(Some(view)) = restore(db, &key, &roots) {
                    let mut entries = worker_state.0.lock().unwrap();
                    let entry = entries.get_mut(&key).unwrap();
                    if entry.views.is_empty() {
                        entry.views.push_back((Instant::now(), view));
                    }
                    worker_state.1.notify_all();
                }
                let prior_view = worker_state.0.lock().unwrap()[&key]
                    .views
                    .iter()
                    .rev()
                    .find(|(_, v)| !preview::is_initial(v))
                    .map(|(_, v)| Arc::clone(v));
                if prior_view.is_none()
                    && worker_state.0.lock().unwrap()[&key].views.is_empty()
                    && let Ok(Some(view)) = preview::prepare(&key, &roots)
                {
                    let mut entries = worker_state.0.lock().unwrap();
                    let entry = entries.get_mut(&key).unwrap();
                    if entry.views.is_empty() {
                        entry.views.push_back((Instant::now(), view));
                    }
                    worker_state.1.notify_all();
                }
                let outcome = sync(db, &key, &roots, verify, prior_view.as_deref(), &mut caches);
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
                        entry.error_code = None;
                    }
                    Err(e) => {
                        entry.error_code = Some(crate::live_index::failure_code(&e));
                        entry.error = Some(format!("{e:#}"));
                    }
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
        if let Some(db) = db {
            db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        }
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
                let configs = Arc::clone(&configs);
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
                        #[derive(Deserialize)]
                        #[serde(deny_unknown_fields)]
                        struct ConfigMessage {
                            config: crate::config_dto::Request,
                            #[serde(default, rename = "nativeHooks")]
                            native_hooks: Option<crate::config::hooks::Capture>,
                        }
                        let value: Value = serde_json::from_str(&input)
                            .map_err(|_| operation_error("INVALID_ARGUMENT", "查询参数无效"))?;
                        if value.get("handoff").is_some() {
                            #[derive(Deserialize)]
                            #[serde(deny_unknown_fields)]
                            struct HandoffMessage {
                                handoff: crate::handoff_dto::Request,
                                #[serde(default, rename = "nativeHooks")]
                                native_hooks: Option<crate::config::hooks::Capture>,
                            }
                            let r: HandoffMessage =
                                serde_json::from_value(value).map_err(|_| {
                                    operation_error("INVALID_ARGUMENT", "Invalid handoff request")
                                })?;
                            let mut cfg = crate::config_dto::Request {
                                roots: r.handoff.roots.clone(),
                                project_roots: r.handoff.project_roots.clone(),
                                read_view: r.handoff.read_view.clone(),
                                ..Default::default()
                            };
                            if r.handoff.action == crate::handoff_dto::Action::Send {
                                if cfg.read_view.is_some() {
                                    config_query(cfg.clone(), None, &state, &jobs, &configs)?;
                                }
                                cfg.read_view = None;
                            }
                            let response = config_query(
                                cfg,
                                r.native_hooks.as_ref(),
                                &state,
                                &jobs,
                                &configs,
                            )?;
                            let id = response.read_view.unwrap();
                            let view = configs.lock().unwrap().get(&id)?;
                            return Ok(serde_json::to_value(crate::handoff::prepare(
                                r.handoff, id, &view,
                            )?)?);
                        }
                        if value.get("optimize").is_some() {
                            #[derive(Deserialize)]
                            #[serde(deny_unknown_fields)]
                            struct OptimizeMessage {
                                optimize: crate::optimize_dto::Request,
                                #[serde(default, rename = "nativeHooks")]
                                native_hooks: Option<crate::config::hooks::Capture>,
                            }
                            let r: OptimizeMessage = serde_json::from_value(value)
                                .map_err(|_| operation_error("INVALID_ARGUMENT", "优化参数无效"))?;
                            if r.optimize.action == crate::optimize_dto::Action::Capabilities {
                                let mut response = crate::optimize::capabilities();
                                response.rule_parameters =
                                    crate::optimize::parameters(r.optimize.rule_overrides)?;
                                return Ok(serde_json::to_value(response)?);
                            }
                            let mut cfg = crate::config_dto::Request {
                                roots: r.optimize.roots.clone(),
                                project_roots: r.optimize.project_roots.clone(),
                                read_view: r.optimize.read_view.clone(),
                                ..Default::default()
                            };
                            if r.optimize.action == crate::optimize_dto::Action::Recheck {
                                if cfg.read_view.is_some() {
                                    config_query(cfg.clone(), None, &state, &jobs, &configs)?;
                                }
                                cfg.read_view = None;
                            }
                            let response = config_query(
                                cfg,
                                r.native_hooks.as_ref(),
                                &state,
                                &jobs,
                                &configs,
                            )?;
                            let id = response.read_view.unwrap();
                            let view = configs.lock().unwrap().get(&id)?;
                            return Ok(serde_json::to_value(crate::optimize::execute(
                                r.optimize, id, &view,
                            )?)?);
                        }
                        if value.get("config").is_some() {
                            let request: ConfigMessage = serde_json::from_value(value)
                                .map_err(|_| operation_error("INVALID_ARGUMENT", "配置参数无效"))?;
                            return Ok(serde_json::to_value(config_query(
                                request.config,
                                request.native_hooks.as_ref(),
                                &state,
                                &jobs,
                                &configs,
                            )?)?);
                        }
                        let request: Request = serde_json::from_value(value)
                            .map_err(|_| operation_error("INVALID_ARGUMENT", "实时查询参数无效"))?;
                        Ok(serde_json::to_value(query(
                            request, &state, &jobs, &configs,
                        )?)?)
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
                    drop(stream);
                    active.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if last_client.elapsed() > Duration::from_secs(15)
                    && active.load(std::sync::atomic::Ordering::Relaxed) == 0
                    && !configs.lock().unwrap().has_views()
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
    #[cfg(unix)]
    let _ = fs::remove_file(socket);
    Ok(())
}
