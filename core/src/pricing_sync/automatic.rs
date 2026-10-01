use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutomaticStatus {
    Checking,
    Updated,
    Unchanged,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Automatic {
    pub status: AutomaticStatus,
    pub attempt_id: String,
    pub attempted_at: String,
    pub retry_at: String,
    pub error_code: Option<String>,
}
fn time(value: i64) -> Result<String> {
    chrono::DateTime::from_timestamp_millis(value)
        .map(|value| value.to_rfc3339())
        .ok_or_else(|| operation_error("PRICE_AUTO_STATE_INVALID", "自动价表时间无效"))
}
fn read_state(root: &Path) -> Result<Option<Automatic>> {
    let file = match fs::File::open(root.join("automatic.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(8193).read_to_end(&mut bytes)?;
    if bytes.len() > 8192 {
        return Err(operation_error(
            "PRICE_AUTO_STATE_INVALID",
            "自动价表状态过大",
        ));
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| operation_error("PRICE_AUTO_STATE_INVALID", "自动价表状态损坏"))
}
pub(super) fn automatic_at(root: &Path, request: HostRequest, now: i64) -> Result<Response> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(root)?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options.open(root.join("automatic.lock"))?;
    lock.lock()?;
    let previous = read_state(root)?;
    let mut result = current_at(root)?;
    result.action = Action::AutoUpdate;
    if let Some(attempt_id) = request.attempt_id {
        let mut state =
            previous.ok_or_else(|| operation_error("PRICE_AUTO_EXPIRED", "自动价表请求已失效"))?;
        // A late/cancelled downloader cannot overwrite a later attempt or a completed attempt.
        if state.attempt_id != attempt_id || state.status != AutomaticStatus::Checking {
            return Err(operation_error("PRICE_AUTO_EXPIRED", "自动价表请求已失效"));
        }
        let update = match (request.document, request.error_code) {
            (Some(document), None) => update_at(root, document),
            (None, Some(code))
                if code.len() <= 80
                    && code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_') =>
            {
                state.error_code = Some(code);
                Err(operation_error("PRICE_FETCH_FAILED", "自动价表下载失败"))
            }
            _ => return Err(operation_error("INVALID_ARGUMENT", "无效自动价表结果")),
        };
        match update {
            Ok(updated) => {
                state.status = if updated.updated {
                    AutomaticStatus::Updated
                } else {
                    AutomaticStatus::Unchanged
                };
                state.retry_at = time(now + 24 * 60 * 60 * 1000)?;
                result = updated;
                result.action = Action::AutoUpdate;
            }
            Err(error) => {
                state.status = AutomaticStatus::Failed;
                state.retry_at = time(now + 15 * 60 * 1000)?;
                if state.error_code.is_none() {
                    state.error_code = Some(
                        error
                            .downcast_ref::<crate::dto::OperationError>()
                            .map(|e| e.code)
                            .unwrap_or("PRICE_UPDATE_FAILED")
                            .into(),
                    );
                }
            }
        }
        crate::storage::atomic_write(&root.join("automatic.json"), &serde_json::to_vec(&state)?)?;
        result.automatic = Some(state);
        return Ok(result);
    }
    if request.document.is_some() || request.error_code.is_some() {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "自动价表结果缺少请求标识",
        ));
    }
    if let Some(previous) = previous {
        let retry = chrono::DateTime::parse_from_rfc3339(&previous.retry_at)
            .map_err(|_| operation_error("PRICE_AUTO_STATE_INVALID", "自动价表重试时间无效"))?
            .timestamp_millis();
        if retry > now {
            result.automatic = Some(previous);
            return Ok(result);
        }
    }
    let state = Automatic {
        status: AutomaticStatus::Checking,
        attempt_id: crate::hash(format!("{}:{now}:{}", root.display(), std::process::id())),
        attempted_at: time(now)?,
        // An interrupted downloader releases its lease without requiring a permanent daemon.
        retry_at: time(now + 60_000)?,
        error_code: None,
    };
    crate::storage::atomic_write(&root.join("automatic.json"), &serde_json::to_vec(&state)?)?;
    result.automatic = Some(state);
    result.download_required = true;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(
        document: Option<String>,
        attempt_id: Option<String>,
        error_code: Option<String>,
    ) -> HostRequest {
        HostRequest {
            action: Action::AutoUpdate,
            document,
            attempt_id,
            error_code,
        }
    }
    #[test]
    fn automatic_leases_cooldowns_and_late_results_preserve_catalog() {
        let root = tempfile::tempdir().unwrap();
        let now = 1_800_000_000_000;
        let first = automatic_at(root.path(), request(None, None, None), now).unwrap();
        assert!(first.download_required);
        let token = first.automatic.unwrap().attempt_id;
        let duplicate = automatic_at(root.path(), request(None, None, None), now + 1).unwrap();
        assert!(!duplicate.download_required);
        let failed = automatic_at(
            root.path(),
            request(None, Some(token.clone()), Some("PRICE_FETCH_FAILED".into())),
            now + 2,
        )
        .unwrap();
        assert_eq!(failed.automatic.unwrap().status, AutomaticStatus::Failed);
        assert_eq!(failed.origin, "bundled");
        assert!(
            !automatic_at(root.path(), request(None, None, None), now + 60_000)
                .unwrap()
                .download_required
        );
        let second = automatic_at(root.path(), request(None, None, None), now + 900_003).unwrap();
        assert!(second.download_required);
        assert!(
            automatic_at(
                root.path(),
                request(
                    Some(
                        include_str!("../../tests/fixtures/official-pricing-synthetic.txt").into()
                    ),
                    Some(token),
                    None
                ),
                now + 900_004
            )
            .is_err()
        );
        let good = automatic_at(
            root.path(),
            request(
                Some(include_str!("../../tests/fixtures/official-pricing-synthetic.txt").into()),
                Some(second.automatic.unwrap().attempt_id),
                None,
            ),
            now + 900_005,
        )
        .unwrap();
        assert!(good.updated);
        assert_eq!(good.automatic.unwrap().status, AutomaticStatus::Updated);
        assert!(
            !automatic_at(root.path(), request(None, None, None), now + 3_600_000)
                .unwrap()
                .download_required
        );
        let active = fs::read(root.path().join("active.json")).unwrap();
        let third = automatic_at(root.path(), request(None, None, None), now + 90_000_000).unwrap();
        let rejected = automatic_at(
            root.path(),
            request(
                Some("# Pricing\nbroken".into()),
                Some(third.automatic.unwrap().attempt_id),
                None,
            ),
            now + 90_000_001,
        )
        .unwrap();
        assert_eq!(
            rejected.automatic.unwrap().error_code.as_deref(),
            Some("PRICE_SOURCE_CHANGED")
        );
        assert_eq!(fs::read(root.path().join("active.json")).unwrap(), active);
    }
    #[test]
    fn abandoned_attempt_expires_and_concurrent_claims_have_one_winner() {
        let root = tempfile::tempdir().unwrap();
        let now = 1_800_000_000_000;
        let results: Vec<_> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    s.spawn(|| automatic_at(root.path(), request(None, None, None), now).unwrap())
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(results.iter().filter(|r| r.download_required).count(), 1);
        assert!(
            automatic_at(root.path(), request(None, None, None), now + 60_001)
                .unwrap()
                .download_required
        );
    }
}
