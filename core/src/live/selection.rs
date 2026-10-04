//! Select cached or live revisions, coordinate refresh jobs and expose actual freshness.
use super::*;
pub(super) fn select_view(
    request: &Request,
    shared: &Shared,
    jobs: &mpsc::SyncSender<Job>,
) -> Result<(Arc<Snapshot>, Freshness)> {
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
    let mut ticket = entry.completed;
    if selector.is_none() && request.mode != Mode::Cached {
        ticket = scheduling::request(entry, &key, request.verify, jobs)?;
        let preview_at = Instant::now() + Duration::from_millis(250);
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
            let initial_available = request.mode == Mode::Auto
                && request.query.action != usage_app_dto::Action::Refresh
                && entries[&key]
                    .views
                    .back()
                    .is_some_and(|(_, v)| preview::is_initial(v));
            if initial_available && Instant::now() >= preview_at {
                break;
            }
            let wait = if initial_available {
                preview_at.min(deadline)
            } else {
                deadline
            }
            .saturating_duration_since(Instant::now());
            entries = wake.wait_timeout(entries, wait).unwrap().0;
        }
    } else if selector.is_none() && entry.views.is_empty() {
        // Cached restoration must not block unrelated ready views.
        let restore_roots = entry.roots.clone();
        drop(entries);
        let db = crate::live_index::open(&directory()?.join("index.sqlite"))?;
        let restored = restore(&db, &key, &restore_roots)?;
        entries = lock.lock().unwrap();
        let entry = entries.get_mut(&key).unwrap();
        if entry.views.is_empty()
            && let Some(view) = restored
        {
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
                entry.error_code.unwrap_or("SOURCE_UNREADABLE")
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
            .iter()
            .rev()
            .find(|(_, v)| request.mode != Mode::Cached || !preview::is_initial(v))
            .map(|(_, v)| Arc::clone(v))
            .ok_or_else(|| {
                operation_error(
                    if request.mode == Mode::Cached {
                        "NO_SNAPSHOT"
                    } else if entry.error.is_some() {
                        entry.error_code.unwrap_or("SOURCE_UNREADABLE")
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
        initial_scan: preview::is_initial(&snapshot),
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
        error_code: entry.error_code.map(String::from),
    };
    drop(entries);
    Ok((snapshot, freshness))
}
