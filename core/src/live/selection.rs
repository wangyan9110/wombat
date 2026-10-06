//! Select cached or live revisions, coordinate refresh jobs and expose actual freshness.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// Business entries validate their own parameters before requesting a read view.
/// Selection owns only source scope, revision identity and synchronization policy.
pub(super) struct ReadViewSelector {
    roots: Vec<String>,
    selector: Option<String>,
    mode: Mode,
    verify: bool,
    refresh: bool,
    capture_now: bool,
    wait: WaitPolicy,
    key: String,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WaitPolicy {
    None,
    Auto,
    Fresh,
}
impl WaitPolicy {
    fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            Self::None => 0,
            Self::Auto => 2,
            Self::Fresh => 10,
        })
    }
}
impl ReadViewSelector {
    pub(super) fn capture_now(mut self) -> Self {
        self.capture_now = true;
        self
    }
    pub(super) fn identity(&self) -> Option<&String> {
        self.selector.as_ref()
    }
    pub(super) fn new(
        roots: Vec<String>,
        selector: Option<String>,
        mode: Mode,
        verify: bool,
        refresh: bool,
    ) -> Result<Self> {
        if (verify && (mode == Mode::Cached || selector.is_some()))
            || (refresh && (mode == Mode::Cached || selector.is_some()))
        {
            return Err(operation_error(
                "INVALID_ARGUMENT",
                "实时同步选项与读取版本不匹配",
            ));
        }
        let key = if let Some(id) = &selector {
            let mut parts = id.split(':');
            let prefix = parts.next();
            let scope = parts.next();
            let revision = parts.next();
            if prefix != Some("live")
                || scope.is_none_or(str::is_empty)
                || revision.is_none_or(str::is_empty)
                || parts.next().is_some()
            {
                return Err(operation_error("INVALID_ARGUMENT", "实时读取版本身份无效"));
            }
            let key = scope.expect("validated scope").to_owned();
            // Omitted scope preserves access to an already published read identity.
            // Explicit source roots cannot silently select a different source set.
            if !roots.is_empty() && source_key(&roots) != key {
                return Err(operation_error(
                    "INVALID_ARGUMENT",
                    "来源范围与实时读取版本不匹配",
                ));
            }
            key
        } else {
            source_key(&roots)
        };
        let wait = if selector.is_some() || mode == Mode::Cached {
            WaitPolicy::None
        } else if refresh || mode == Mode::Fresh {
            WaitPolicy::Fresh
        } else {
            WaitPolicy::Auto
        };
        Ok(Self {
            roots,
            selector,
            mode,
            verify,
            refresh,
            capture_now: false,
            wait,
            key,
        })
    }
}
fn check_cancel(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        Err(operation_error("CANCELLED", "读取已取消"))
    } else {
        Ok(())
    }
}

pub(super) fn select_view(
    request: &ReadViewSelector,
    shared: &Shared,
    jobs: &mpsc::SyncSender<Job>,
    cancelled: &AtomicBool,
) -> Result<(Arc<Snapshot>, Freshness)> {
    check_cancel(cancelled)?;
    let roots = request.roots.clone();
    let selector = &request.selector;
    let key = &request.key;
    let (lock, wake) = &**shared;
    let mut entries = lock.lock().unwrap();
    // A fixed lookup cannot establish synchronization scope. In particular,
    // omitted roots must not seed an entry later reused by an explicit-root read.
    if selector.is_some() && !entries.contains_key(key) {
        return Err(operation_error(
            "VIEW_EXPIRED",
            "这个实时读取版本已过期，请重新打开列表",
        ));
    }
    let entry = entries
        .entry(key.clone())
        .or_insert_with(|| Entry::new(roots));
    entry.touched = Instant::now();
    let mut ticket = entry.completed;
    if request.wait != WaitPolicy::None
        && (request.mode == Mode::Fresh
            || request.refresh
            || request.capture_now
            || entry.requested == 0
            || entry.syncing
            || scheduling::auto_due(entry))
    {
        ticket = scheduling::request(entry, key, request.verify, jobs)?;
        let preview_at = Instant::now() + Duration::from_millis(250);
        let deadline = Instant::now() + request.wait.timeout();
        while entries[key].completed < ticket && Instant::now() < deadline {
            check_cancel(cancelled)?;
            let initial_available = request.wait == WaitPolicy::Auto
                && entries[key]
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
            // Cancelling one reader never removes or interrupts shared work.
            entries = wake
                .wait_timeout(entries, wait.min(Duration::from_millis(50)))
                .unwrap()
                .0;
        }
    } else if selector.is_none() && entry.views.is_empty() {
        // Cached restoration must not block unrelated ready views.
        let restore_roots = entry.roots.clone();
        drop(entries);
        let db = crate::live_index::open(&directory()?.join("index.sqlite"))?;
        let restored = restore(&db, key, &restore_roots)?;
        entries = lock.lock().unwrap();
        let entry = entries.get_mut(key).unwrap();
        if entry.views.is_empty()
            && let Some(view) = restored
        {
            entry.views.push_back((Instant::now(), view));
        }
    }
    check_cancel(cancelled)?;
    let entry = entries.get_mut(key).unwrap();
    let current = entry.completed >= ticket && entry.error.is_none() && !entry.syncing;
    if (request.mode == Mode::Fresh || request.refresh) && !current && selector.is_none() {
        return Err(operation_error(
            if entry.error.is_some() {
                entry.error_code.unwrap_or("SOURCE_UNREADABLE")
            } else {
                "SYNC_TIMEOUT"
            },
            "未能在限定时间内完成同步，请重试或使用 --cached",
        ));
    }
    let snapshot = if let Some(selector) = selector {
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

#[cfg(test)]
mod tests;
