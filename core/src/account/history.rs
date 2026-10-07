//! Private, version-checked native observation history. Reads never contact Codex.
use super::*;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::{fs, path::Path, time::Duration};
const VERSION: i64 = 1;
const PAGE: usize = 20;
const MAX_OBSERVATION_BYTES: usize = 128 * 1024;
fn file(root: &Path) -> std::path::PathBuf {
    root.join("account-history.sqlite")
}
fn check(db: &Connection) -> Result<i64> {
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if ![0, VERSION].contains(&version) {
        return Err(operation_error(
            "UNSUPPORTED_VERSION",
            "Unsupported account history version",
        ));
    }
    Ok(version)
}
fn open(root: &Path, write: bool) -> Result<Option<Connection>> {
    let path = file(root);
    match fs::symlink_metadata(&path) {
        Ok(m) if !m.is_file() || m.file_type().is_symlink() => {
            return Err(operation_error(
                "HISTORY_UNAVAILABLE",
                "Invalid account history file",
            ));
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if !write {
                return Ok(None);
            }
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(root)?;
            match crate::storage::write_unpublished(&path, b"") {
                Ok(()) => {}
                Err(e)
                    if e.downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) => {}
                Err(e) => return Err(e),
            }
        }
        Err(e) => return Err(e.into()),
    }
    let flags = if write {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    let mut db = Connection::open_with_flags(path, flags | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    db.busy_timeout(Duration::from_secs(5))?;
    let version = check(&db)?;
    if version == 0 {
        if !write {
            return Err(operation_error(
                "UNSUPPORTED_VERSION",
                "Uninitialized account history",
            ));
        }
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if check(&tx)? == 0 {
            let tables: i64 = tx.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                [],
                |r| r.get(0),
            )?;
            if tables != 0 {
                return Err(operation_error(
                    "UNSUPPORTED_VERSION",
                    "Unknown unversioned account history",
                ));
            }
            tx.execute_batch("CREATE TABLE observations (sequence INTEGER PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL)")?;
            tx.pragma_update(None, "user_version", VERSION)?;
        }
        tx.commit()?;
    }
    Ok(Some(db))
}
pub(super) fn record(root: &Path, out: &Response, at: &str) -> Result<()> {
    let observation = AllowanceObservation {
        native_version: out.native_version.clone(),
        id: uuid::Uuid::new_v4().to_string(),
        observed_at: at.into(),
        account_id: out.identity.as_ref().map(|i| i.id.clone()),
        status: if out.account.status == "available" {
            out.allowance.status.clone()
        } else {
            "unavailable".into()
        },
        windows: out
            .windows
            .iter()
            .map(|w| AllowanceWindowObservation {
                id: w.id.clone(),
                bucket_id: w.bucket_id.clone(),
                used_percent: w.used_percent,
                duration_minutes: w.duration_minutes,
                resets_at: w.resets_at.clone(),
                status: w.status.clone(),
                delta_percentage_points: None,
                interval_status: AllowanceIntervalStatus::First,
            })
            .collect(),
    };
    let bytes = serde_json::to_vec(&observation)?;
    if bytes.len() > MAX_OBSERVATION_BYTES {
        return Err(operation_error(
            "RESOURCE_LIMIT",
            "Account observation exceeds history budget",
        ));
    }
    let mut db = open(root, true)?.unwrap();
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    check(&tx)?;
    tx.execute(
        "INSERT INTO observations(version,body) VALUES (?1,?2)",
        rusqlite::params![VERSION, std::str::from_utf8(&bytes)?],
    )?;
    tx.commit()?;
    Ok(())
}
fn interval(
    a: &AllowanceObservation,
    b: &AllowanceObservation,
    w: &AllowanceWindowObservation,
) -> (AllowanceIntervalStatus, Option<f64>) {
    use AllowanceIntervalStatus::*;
    if a.status != "available"
        || b.status != "available"
        || a.account_id.is_none()
        || b.account_id.is_none()
    {
        return (ObservationGap, None);
    }
    if a.account_id != b.account_id {
        return (AccountChanged, None);
    }
    let Some(prior) = a
        .windows
        .iter()
        .find(|p| p.id == w.id && p.bucket_id == w.bucket_id)
    else {
        return (WindowChanged, None);
    };
    if w.duration_minutes.is_none() || prior.duration_minutes.is_none() {
        return (DurationUnknown, None);
    }
    if w.duration_minutes != prior.duration_minutes {
        return (WindowChanged, None);
    }
    if w.resets_at != prior.resets_at {
        return (ResetChanged, None);
    }
    let times = DateTime::parse_from_rfc3339(&a.observed_at)
        .ok()
        .zip(DateTime::parse_from_rfc3339(&b.observed_at).ok());
    let Some((before, now)) = times else {
        return (TimeOrder, None);
    };
    if before >= now {
        return (TimeOrder, None);
    }
    let Some(reset) = w
        .resets_at
        .as_deref()
        .and_then(|r| DateTime::parse_from_rfc3339(r).ok())
    else {
        return (ObservationGap, None);
    };
    if reset <= now || w.status != "current" || prior.status != "current" {
        return (Expired, None);
    }
    (Compatible, Some(w.used_percent - prior.used_percent))
}
fn read_at(root: &Path) -> Result<AllowanceHistory> {
    let mut out = AllowanceHistory {
        method_version: 1,
        total_observations: 0,
        observations: vec![],
    };
    let Some(mut db) = open(root, false)? else {
        return Ok(out);
    };
    let tx = db.transaction()?;
    check(&tx)?;
    out.total_observations =
        u64::try_from(tx.query_row("SELECT COUNT(*) FROM observations", [], |r| {
            r.get::<_, i64>(0)
        })?)?;
    let mut stmt=tx.prepare("SELECT version, length(CAST(body AS BLOB)), body FROM observations ORDER BY sequence DESC LIMIT ?1")?;
    let mut rows = stmt.query([(PAGE + 1) as i64])?;
    let mut observations = vec![];
    while let Some(row) = rows.next()? {
        let version: i64 = row.get(0)?;
        if version != VERSION {
            return Err(operation_error(
                "UNSUPPORTED_VERSION",
                "Unsupported stored account observation",
            ));
        }
        let size: i64 = row.get(1)?;
        if size > MAX_OBSERVATION_BYTES as i64 {
            return Err(operation_error(
                "RESOURCE_LIMIT",
                "Stored account observation exceeds budget",
            ));
        }
        observations.push(serde_json::from_str::<AllowanceObservation>(
            &row.get::<_, String>(2)?,
        )?);
    }
    observations.reverse();
    for pair in observations.windows(2) {
        let mut current = pair[1].clone();
        for w in &mut current.windows {
            let (status, delta) = interval(&pair[0], &pair[1], w);
            w.interval_status = status;
            w.delta_percentage_points = delta;
        }
        out.observations.push(current);
    }
    if out.total_observations <= PAGE as u64
        && let Some(first) = observations.first()
    {
        out.observations.insert(0, first.clone());
    }
    out.observations.reverse();
    if serde_json::to_vec(&out)?.len() > 256 * 1024 {
        return Err(operation_error(
            "RESOURCE_LIMIT",
            "History result exceeds output budget",
        ));
    }
    Ok(out)
}
pub(crate) fn read(r: crate::account_dto::Request) -> Result<Response> {
    if r.action != Action::History {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "Account history requires history action",
        ));
    }
    let mut out = normalize(Capture {
        action: Action::History,
        native_version: None,
        checked_at: chrono::Utc::now().to_rfc3339(),
        before: None,
        after: None,
        rates: None,
        activity: None,
        account_error: None,
        rates_error: None,
        activity_error: None,
    })?;
    out.history = Some(read_at(&crate::storage::data_home()?)?);
    if serde_json::to_vec(&out)?.len() > 256 * 1024 {
        return Err(operation_error(
            "RESOURCE_LIMIT",
            "Account history response exceeds output budget",
        ));
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn observation(account: &str, at: &str, used: f64, reset: &str) -> AllowanceObservation {
        AllowanceObservation {
            native_version: None,
            id: at.into(),
            observed_at: at.into(),
            account_id: Some(account.into()),
            status: "available".into(),
            windows: vec![AllowanceWindowObservation {
                id: "primary".into(),
                bucket_id: "codex".into(),
                used_percent: used,
                duration_minutes: Some(300),
                resets_at: Some(reset.into()),
                status: "current".into(),
                delta_percentage_points: None,
                interval_status: AllowanceIntervalStatus::First,
            }],
        }
    }
    #[test]
    fn intervals_never_bridge_identity_reset_missing_or_unordered_observations() {
        let a = observation("a", "2026-10-07T00:00:00Z", 20.0, "2026-10-07T04:00:00Z");
        let b = observation("a", "2026-10-07T01:00:00Z", 35.0, "2026-10-07T04:00:00Z");
        assert_eq!(
            interval(&a, &b, &b.windows[0]),
            (AllowanceIntervalStatus::Compatible, Some(15.0))
        );
        let mut c = b.clone();
        c.account_id = Some("b".into());
        assert_eq!(interval(&a, &c, &c.windows[0]).1, None);
        let mut c = b.clone();
        c.windows[0].resets_at = Some("2026-10-08T04:00:00Z".into());
        assert_eq!(
            interval(&a, &c, &c.windows[0]).0,
            AllowanceIntervalStatus::ResetChanged
        );
        let mut c = b.clone();
        c.status = "unavailable".into();
        assert_eq!(
            interval(&c, &b, &b.windows[0]).0,
            AllowanceIntervalStatus::ObservationGap
        );
        assert_eq!(
            interval(&b, &a, &a.windows[0]).0,
            AllowanceIntervalStatus::TimeOrder
        );
    }
    #[test]
    fn history_preserves_equal_values_and_gap_events_across_reopen() {
        let root = tempfile::tempdir().unwrap();
        let mut out = normalize(Capture {
            action: Action::Read,
            native_version: None,
            checked_at: "2026-10-07T00:00:00Z".into(),
            before: None,
            after: None,
            rates: None,
            activity: None,
            account_error: None,
            rates_error: None,
            activity_error: None,
        })
        .unwrap();
        out.account.status = "available".into();
        out.allowance.status = "available".into();
        out.identity = Some(Identity {
            id: "synthetic".into(),
            kind: "chatgpt".into(),
            masked_email: Some("sy***@example.test".into()),
            plan: None,
        });
        out.windows = vec![Window {
            id: "primary".into(),
            bucket_id: "codex".into(),
            bucket_name: None,
            model: None,
            used_percent: 20.0,
            duration_minutes: Some(300),
            resets_at: Some("2026-10-07T04:00:00Z".into()),
            status: "current".into(),
        }];
        record(root.path(), &out, "2026-10-07T00:00:00Z").unwrap();
        record(root.path(), &out, "2026-10-07T00:01:00Z").unwrap();
        let first = read_at(root.path()).unwrap();
        assert_eq!(first.total_observations, 2);
        assert_eq!(
            first.observations[0].windows[0].delta_percentage_points,
            Some(0.0)
        );
        let ids = first
            .observations
            .iter()
            .map(|o| o.id.clone())
            .collect::<Vec<_>>();
        assert_ne!(ids[0], ids[1]);
        assert_eq!(read_at(root.path()).unwrap().observations[0].id, ids[0]);
        out.allowance.status = "unavailable".into();
        out.windows.clear();
        record(root.path(), &out, "2026-10-07T00:02:00Z").unwrap();
        out.allowance.status = "available".into();
        out.windows = vec![Window {
            id: "primary".into(),
            bucket_id: "codex".into(),
            bucket_name: None,
            model: None,
            used_percent: 35.0,
            duration_minutes: Some(300),
            resets_at: Some("2026-10-07T04:00:00Z".into()),
            status: "current".into(),
        }];
        record(root.path(), &out, "2026-10-07T00:03:00Z").unwrap();
        let history = read_at(root.path()).unwrap();
        assert_eq!(history.total_observations, 4);
        assert_eq!(
            history.observations[0].windows[0].interval_status,
            AllowanceIntervalStatus::ObservationGap
        );
        assert!(
            !serde_json::to_string(&history)
                .unwrap()
                .contains("example.test")
        );
        let before = fs::read(file(root.path())).unwrap();
        let _ = read_at(root.path()).unwrap();
        assert_eq!(fs::read(file(root.path())).unwrap(), before);
    }
    #[test]
    fn missing_history_is_read_only_and_unknown_versions_preserve_bytes() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(read_at(root.path()).unwrap().total_observations, 0);
        assert!(!file(root.path()).exists());
        let db = open(root.path(), true).unwrap().unwrap();
        db.pragma_update(None, "user_version", 99).unwrap();
        drop(db);
        let before = fs::read(file(root.path())).unwrap();
        assert!(
            read_at(root.path())
                .unwrap_err()
                .downcast_ref::<crate::dto::OperationError>()
                .is_some_and(|e| e.code == "UNSUPPORTED_VERSION")
        );
        assert!(open(root.path(), true).is_err());
        assert_eq!(fs::read(file(root.path())).unwrap(), before);
    }
}
