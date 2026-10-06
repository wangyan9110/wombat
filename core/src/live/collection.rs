//! Incremental collection commits cursors and facts together, then publishes an immutable revision.
use super::*;
pub(super) fn sources(roots: &[String]) -> DiscoveryReport {
    adapters::codex::CodexAdapter.discover(&DiscoveryRequest {
        roots: roots.iter().map(PathBuf::from).collect(),
    })
}
pub(super) fn source_key(roots: &[String]) -> String {
    let mut ids: Vec<_> = sources(roots).sources.into_iter().map(|s| s.id).collect();
    ids.sort();
    crate::hash(ids.join(":"))
}
pub(super) fn load_collected(db: &rusqlite::Connection, key: &str) -> Result<Option<Collected>> {
    validate_message_mapping(db, key)?;
    let mut value = Collected::default();
    let mut paths = EvidencePaths::default();
    let mut watermark_version = None;
    let mut strings = adapters::shared_strings::FactStrings::default();
    let found = crate::live_index::each(db, &format!("projection:{key}"), |field, id, payload| {
        macro_rules! rows {
            ($name:ident) => {
                value.$name.push(serde_json::from_str(payload)?);
            };
        }
        match field {
            field
                if crate::observation_versions::ObservationHeaderSet::Projection
                    .kinds()
                    .iter()
                    .any(|kind| kind.field() == field) => {}
            "watermarkVersion" => {
                watermark_version = Some(serde_json::from_str::<u32>(payload)?);
            }
            "watermarks" => {
                rows!(watermarks);
                let row = value.watermarks.last().expect("just appended watermark");
                anyhow::ensure!(
                    row.file_id == id && row.source_instance_id == key,
                    "projection watermark identity mismatch"
                );
            }
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
                if let Some(row) = value.measurements.last_mut() {
                    let row = Arc::make_mut(row);
                    paths.compact(&mut row.evidence);
                    strings.measurement(row);
                }
            }
            "operations" => {
                rows!(operations);
                if let Some(row) = value.operations.last_mut() {
                    let row = Arc::make_mut(row);
                    paths.compact(&mut row.evidence);
                    strings.operation(row);
                }
            }
            "title_observations" => {
                rows!(title_observations);
                let observation = value
                    .title_observations
                    .last()
                    .expect("just appended observation");
                observation.validate()?;
                anyhow::ensure!(
                    observation.thread_id == id && observation.source_instance_id == key,
                    "projection title scope mismatch"
                );
            }
            "events" => {
                rows!(events);
            }
            "issues" => {
                value.issues = serde_json::from_str(payload)?;
            }
            _ => anyhow::bail!("unsupported projection field: {field}"),
        }
        Ok(())
    })?;
    if found {
        if watermark_version != Some(WATERMARK_FORMAT_VERSION) {
            return Err(operation_error(
                "UNSUPPORTED_VERSION",
                "不支持此投影水位格式",
            ));
        }
        validate_watermarks(&value.watermarks)?;
        let targets: BTreeMap<_, _> = value.threads.iter().map(|t| (t.id.as_str(), t)).collect();
        let mut seen = std::collections::BTreeSet::new();
        for observation in &value.title_observations {
            let thread = targets
                .get(observation.thread_id.as_str())
                .ok_or_else(|| anyhow::anyhow!("projection title target missing"))?;
            anyhow::ensure!(
                seen.insert(&observation.thread_id)
                    && thread.source_instance_id == observation.source_instance_id
                    && thread.title.as_deref() == Some(observation.title.as_str()),
                "projection title scope mismatch"
            );
        }
    }
    Ok(found.then_some(value))
}

/// Guard before reading facts and before sync's unchanged/cached fast path.
fn validate_message_mapping(db: &rusqlite::Connection, key: &str) -> Result<()> {
    let scope = format!("projection:{key}");
    if crate::live_index::has_scope(db, &scope)? {
        crate::observation_versions::ObservationHeaderSet::Projection.validate_index(
            |field| crate::live_index::scalar(db, &scope, field),
            |_| "不支持此投影来源观察映射",
        )?;
    }
    Ok(())
}

pub(super) fn sync(
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
    let mut tx = db.transaction()?;
    let mut failures = BTreeMap::<String, SourceReport>::new();
    let mut failure_watermarks = BTreeMap::<String, Vec<SourceWatermark>>::new();
    let mut changed = false;
    let mut epochs = BTreeMap::new();
    let mut updated = BTreeMap::new();
    for source in &discovered.sources {
        validate_message_mapping(&tx, &source.id)?;
    }
    for source in &discovered.sources {
        let cache = caches.entry(source.id.clone()).or_default();
        if cache.needs_seed()
            && let Some(prior) = prior_view
        {
            cache.seed(
                prior.measurement_facts().cloned().collect(),
                prior.operation_facts().cloned().collect(),
            );
        }

        let mut source_tx = tx.savepoint()?;
        let outcome = adapters::codex::incremental::sync_cached(&source_tx, source, verify, cache);
        let synced = match outcome {
            Ok(value) => {
                source_tx.commit()?;
                value
            }
            Err(error) => {
                source_tx.rollback()?;
                drop(source_tx);
                caches.remove(&source.id);
                if error
                    .downcast_ref::<crate::dto::OperationError>()
                    .is_some_and(|error| error.code == "UNSUPPORTED_VERSION")
                {
                    // Earlier sources may have updated in-memory facts inside this
                    // transaction; discard them along with the durable rollback.
                    caches.clear();
                    return Err(error);
                }
                let mut report = prior_view
                    .and_then(|v| v.manifest.sources.iter().find(|s| s.source.id == source.id))
                    .cloned()
                    .unwrap_or_else(|| SourceReport {
                        source: source.clone(),
                        adapter_version: adapters::codex::CodexAdapter.descriptor().adapter_version,
                        source_versions: vec![],
                        capabilities: adapters::codex::CodexAdapter.descriptor().capabilities,
                        status: String::new(),
                        files_read: 0,
                        bytes_read: 0,
                        issues: vec![],
                    });
                report.status = "failed".into();
                report.files_read = 0;
                report.bytes_read = 0;
                report.issues.retain(|i| i.code != "sourceSyncFailed");
                report.issues.push(Issue {
                    code: "sourceSyncFailed".into(),
                    message: format!("来源同步失败，保留上次成功数据：{error}"),
                    source_instance_id: Some(source.id.clone()),
                    evidence: None,
                });
                // Source savepoint was rolled back: only previous committed file
                // positions may be retained. This attempt has no captured length.
                let at = chrono::Utc::now().to_rfc3339();
                let watermarks = load_collected(&tx, &source.id)?
                    .map(|v| v.watermarks)
                    .or_else(|| {
                        prior_view.map(|v| {
                            v.manifest
                                .watermarks
                                .iter()
                                .filter(|w| w.source_instance_id == source.id)
                                .cloned()
                                .collect()
                        })
                    })
                    .unwrap_or_default()
                    .iter()
                    .map(|w| {
                        w.unavailable(
                            WatermarkState::Failed,
                            WatermarkIssue::SourceSyncFailed,
                            &at,
                        )
                    })
                    .collect();
                failure_watermarks.insert(source.id.clone(), watermarks);
                failures.insert(source.id.clone(), report);
                None
            }
        };
        if let Some(synced) = synced {
            let cache = &caches[&source.id];
            let value = synced.collected;
            let scope = format!("projection:{}", source.id);
            let projection = cache.projection(&tx, source, &scope)?;
            crate::live_index::replace_field(
                &tx,
                &scope,
                "sources",
                value.sources.iter().map(|s| (s.source.id.as_str(), s)),
            )?;
            crate::live_index::put(
                &tx,
                &scope,
                "watermarkVersion",
                "",
                &WATERMARK_FORMAT_VERSION,
            )?;
            for &kind in crate::observation_versions::ObservationHeaderSet::Projection.kinds() {
                let version = kind.current();
                crate::live_index::put(&tx, &scope, kind.field(), "", &version)?;
            }
            crate::live_index::replace_field(
                &tx,
                &scope,
                "watermarks",
                value.watermarks.iter().map(|w| (w.file_id.as_str(), w)),
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
            crate::live_index::replace_field(
                &tx,
                &scope,
                "title_observations",
                value
                    .title_observations
                    .iter()
                    .map(|v| (v.thread_id.as_str(), v)),
            )?;
            save!(threads);
            save!(turns);
            if let Some(delta) = synced.measurements {
                for row in delta.upsert {
                    projection.measurement(&row)?;
                }
                for id in delta.remove {
                    crate::live_index::remove(&tx, &scope, "measurements", &id)?;
                }
            } else {
                for row in &value.measurements {
                    projection.measurement(row)?;
                }
                crate::live_index::retain_field(
                    &tx,
                    &scope,
                    "measurements",
                    value.measurements.iter().map(|r| r.id.as_str()),
                )?;
            }
            crate::live_index::put(&tx, &scope, "issues", "", &value.issues)?;
            if let Some(dirty) = synced.operations {
                for operation in &value.operations {
                    if dirty.contains(&operation.id) {
                        projection.operation(operation)?;
                    }
                }
            } else {
                for row in &value.operations {
                    projection.operation(row)?;
                }
                crate::live_index::retain_field(
                    &tx,
                    &scope,
                    "operations",
                    value.operations.iter().map(|r| r.id.as_str()),
                )?;
            }
            for event in &value.events {
                projection.event(event)?;
            }
            crate::live_index::retain_field(
                &tx,
                &scope,
                "events",
                value.events.iter().map(|e| e.id()),
            )?;
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
    if !failures.is_empty() && failures.len() == discovered.sources.len() {
        return Err(operation_error(
            "SOURCE_UNREADABLE",
            "没有可读取的来源，保留已提交数据",
        ));
    }
    let prices = crate::pricing_sync::current()?;
    let prior = crate::live_index::load_map(&tx, &format!("view:{key}"))?;
    changed |= prior.get("failures").unwrap_or(&json!({})) != &serde_json::to_value(&failures)?;
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
        let mut value = match updated.remove(&source.id) {
            Some(value) => value,
            None => load_collected(&tx, &source.id)?.unwrap_or_default(),
        };
        if let Some(failure) = failures.get(&source.id) {
            value.sources = vec![failure.clone()];
            value.issues = failure.issues.clone();
            value.watermarks = failure_watermarks
                .get(&source.id)
                .cloned()
                .unwrap_or_default();
        }
        collected.watermarks.extend(value.watermarks);
        collected.sources.extend(value.sources);
        collected.issues.extend(value.issues);
        collected.threads.extend(value.threads);
        collected.turns.extend(value.turns);
        collected.measurements.extend(value.measurements);
        collected.operations.extend(value.operations);
        collected.events.extend(value.events);
        collected
            .title_observations
            .extend(value.title_observations);
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
        json!({"id": id,"prices":prices.catalog_hash,"epochs":epochs,"failures":failures,"failureWatermarks":failure_watermarks,"createdAt":snapshot.manifest.snapshot_ref.created_at})
            .as_object()
            .unwrap(),
    )?;
    tx.commit()?;
    Ok(Some(snapshot))
}
pub(super) fn restore(
    db: &rusqlite::Connection,
    key: &str,
    roots: &[String],
) -> Result<Option<Arc<Snapshot>>> {
    // Pin all projection/epoch reads to one committed SQLite view.
    let read_tx = db.unchecked_transaction()?;
    let db = &read_tx;
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
        let failure = prior
            .get("failures")
            .and_then(|v| v.get(&source.id))
            .map(|v| serde_json::from_value::<SourceReport>(v.clone()))
            .transpose()?;
        let mut v = match load_collected(db, &source.id)? {
            Some(v) => v,
            None if failure.is_some() => Collected::default(),
            None => return Ok(None),
        };
        if let Some(failure) = failure {
            v.issues = failure.issues.clone();
            v.sources = vec![failure];
            v.watermarks = serde_json::from_value(
                prior
                    .get("failureWatermarks")
                    .and_then(|v| v.get(&source.id))
                    .ok_or_else(|| anyhow::anyhow!("missing failure watermark observations"))?
                    .clone(),
            )?;
            validate_watermarks(&v.watermarks)?;
        }
        collected.watermarks.extend(v.watermarks);
        collected.sources.extend(v.sources);
        collected.issues.extend(v.issues);
        collected.threads.extend(v.threads);
        collected.turns.extend(v.turns);
        collected.measurements.extend(v.measurements);
        collected.operations.extend(v.operations);
        collected.events.extend(v.events);
        collected.title_observations.extend(v.title_observations);
    }
    let mut snapshot = crate::usage_store::memory(collected, id.into(), prices, None)?;
    if let Some(at) = prior.get("createdAt").and_then(Value::as_str) {
        snapshot.manifest.snapshot_ref.created_at = at.into();
    }
    Ok(Some(Arc::new(snapshot)))
}

#[cfg(test)]
mod observation_tests;
#[cfg(test)]
mod watermark_tests;
