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
    let mut value = Collected::default();
    let mut paths = EvidencePaths::default();
    let mut strings = adapters::shared_strings::FactStrings::default();
    let found =
        crate::live_index::each(db, &format!("projection:{key}"), |field, _id, payload| {
            macro_rules! rows {
                ($name:ident) => {
                    value.$name.push(serde_json::from_str(payload)?);
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
                "issues" => {
                    value.issues = serde_json::from_str(payload)?;
                }
                _ => anyhow::bail!("unsupported projection field: {field}"),
            }
            Ok(())
        })?;
    Ok(found.then_some(value))
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
    let mut changed = false;
    let mut epochs = BTreeMap::new();
    let mut updated = BTreeMap::new();
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
        }
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
        json!({"id": id,"prices":prices.catalog_hash,"epochs":epochs,"failures":failures,"createdAt":snapshot.manifest.snapshot_ref.created_at})
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
        }
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
