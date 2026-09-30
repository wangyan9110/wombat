//! Durable parser checkpoints contain allowlisted facts only, never event bodies.
use super::*;
use anyhow::Result;
use rusqlite::Connection;

use std::time::UNIX_EPOCH;

#[derive(Default, Serialize, Deserialize)]
pub(super) struct Checkpoint {
    pub offset: u64,
    pub line: u64,
    pub state: State,
    stamp: String,
    boundary: String,
    issues: Vec<Issue>,
}

fn stamp(meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    let physical = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let physical = format!("{:?}", meta.created().ok());
    format!(
        "{physical}:{}:{}",
        meta.len(),
        meta.modified()
            .ok()
            .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos())
    )
}
fn boundary(path: &Path, offset: u64) -> Result<String> {
    let mut f = File::open(path)?;
    let mut digest = Sha256::new();
    for (start, count) in [
        (0, offset.min(4096)),
        (offset.saturating_sub(4096), offset.min(4096)),
    ] {
        f.seek(SeekFrom::Start(start))?;
        let mut bytes = vec![0; count as usize];
        f.read_exact(&mut bytes)?;
        digest.update(bytes);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[derive(Default)]
pub(crate) struct Cache {
    facts: Option<Facts>,
}

impl Cache {
    pub(crate) fn share_measurements<'a>(
        &mut self,
        rows: impl Iterator<Item = &'a Arc<Measurement>>,
    ) {
        if let Some(facts) = &mut self.facts {
            for row in rows {
                if let Some(candidate) = facts.measurements.get_mut(&row.id)
                    && candidate.measurement == *row
                {
                    candidate.measurement = Arc::clone(row);
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn sync(
    db: &Connection,
    source: &SourceInstance,
    verify: bool,
) -> Result<Option<Collected>> {
    Ok(sync_cached(db, source, verify, &mut Cache::default())?.map(|(value, _)| value))
}

fn load_facts(db: &Connection, scope: &str) -> Result<Facts> {
    let mut facts = Facts::default();
    crate::live_index::each(db, scope, |field, id, payload| {
        match field {
            "threads" => {
                facts
                    .threads
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "turns" => {
                facts
                    .turns
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "measurements" => {
                facts
                    .measurements
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "operations" => {
                facts
                    .operations
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "aliases" => {
                facts
                    .aliases
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "parents" => {
                facts
                    .parents
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "migrated" => {
                facts
                    .migrated
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "projects" => {
                facts
                    .projects
                    .insert(id.into(), serde_json::from_str(payload)?);
            }
            "measurement_conflicts" => {
                facts.measurement_conflicts = serde_json::from_str(payload)?;
            }
            _ => anyhow::bail!("unsupported fact field: {field}"),
        }
        Ok(())
    })?;
    Ok(facts)
}

type Synced = (Collected, Option<BTreeSet<String>>);
pub(crate) fn sync_cached(
    db: &Connection,
    source: &SourceInstance,
    verify: bool,
    cache: &mut Cache,
) -> Result<Option<Synced>> {
    let context = RunContext::default();
    let mut report = SourceReport {
        source: source.clone(),
        adapter_version: VERSION.into(),
        source_versions: vec![],
        capabilities: CodexAdapter.descriptor().capabilities,
        status: "complete".into(),
        files_read: 0,
        bytes_read: 0,
        issues: vec![],
    };
    let root = Path::new(&source.root);
    let mut files = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for directory in [root.join("sessions"), root.join("archived_sessions")] {
        list_files(
            &directory,
            0,
            &mut files,
            &mut visited,
            &context,
            &mut report,
        );
    }
    let scope = format!("parser:{}:{VERSION}:1", source.id);
    let previous = crate::live_index::load_map(db, &scope)?;
    let mut checkpoints: BTreeMap<String, Checkpoint> = previous
        .get("checkpoints")
        .map(|v| serde_json::from_value(v.clone()))
        .transpose()?
        .unwrap_or_default();
    let title_stamp = fs::metadata(root.join("session_index.jsonl"))
        .ok()
        .map(|m| stamp(&m));
    let mut changed =
        previous.is_empty() || previous.get("titleStamp") != Some(&serde_json::json!(title_stamp));
    let mut rebuild = verify;
    let mut dirty = BTreeSet::new();
    for file in &files {
        let key = file.to_string_lossy().into_owned();
        let meta = fs::metadata(file)?;
        if let Some(cp) = checkpoints.get(&key) {
            if cp.stamp == stamp(&meta) && !verify {
                continue;
            }
            if meta.len() < cp.offset
                || boundary(file, cp.offset).ok().as_ref() != Some(&cp.boundary)
                || (meta.len() == cp.offset && cp.stamp != stamp(&meta))
            {
                rebuild = true;
            }
        }
        dirty.insert(key);
    }
    let missing: BTreeSet<_> = checkpoints
        .keys()
        .filter(|p| !files.contains(Path::new(p)))
        .cloned()
        .collect();
    // Removing a log is not evidence that its historical consumption was zero.
    for path in &missing {
        issue(
            &mut report,
            "sourceMissing",
            "已索引的日志不可用，保留已观察用量",
            Some(EvidenceRef {
                file: path.clone(),
                line: 0,
            }),
        );
    }
    changed |= !dirty.is_empty()
        || rebuild
        || previous.get("missing") != Some(&serde_json::json!(missing));
    if !changed {
        return Ok(None);
    }
    let fact_scope = format!("{scope}:facts");
    let mut facts = match cache.facts.take() {
        Some(facts) => facts,
        None => load_facts(db, &fact_scope)?,
    };
    let prior_migrations = facts.migrated.clone();
    facts.dirty_operations.clear();
    facts.dirty_measurements.clear();
    facts.dirty_aliases.clear();
    facts.identities = identity::read_registry();
    if rebuild {
        // Cross-file ownership and late direct measurements require source-wide
        // reconciliation. Retain facts evidenced solely by now-missing files.
        facts.measurements.retain(|_, c| {
            !c.measurement.evidence.is_empty()
                && c.measurement
                    .evidence
                    .iter()
                    .all(|e| missing.contains(&e.file))
        });
        facts.operations.retain(|_, o| {
            !o.evidence.is_empty() && o.evidence.iter().all(|e| missing.contains(&e.file))
        });
        let retained_threads: BTreeSet<_> = facts
            .measurements
            .values()
            .filter_map(|c| c.measurement.thread_id.clone())
            .chain(facts.operations.values().map(|o| o.thread_id.clone()))
            .collect();
        facts.threads.retain(|id, _| retained_threads.contains(id));
        facts
            .turns
            .retain(|_, t| retained_threads.contains(&t.thread_id));
        facts.projects.retain(|id, _| retained_threads.contains(id));
        facts.aliases.clear();
        facts.measurement_conflicts.clear();
        facts.parents.retain(|id, _| retained_threads.contains(id));
        checkpoints.retain(|p, _| missing.contains(p));
        dirty = files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
    }
    for path in dirty {
        let checkpoint = checkpoints.entry(path.clone()).or_default();
        let before = fs::metadata(&path)?;
        checkpoint.issues.clear();
        let first = report.issues.len();
        read_file_from(
            Path::new(&path),
            source,
            &context,
            &mut facts,
            &mut report,
            Some(checkpoint),
        );
        let after = fs::metadata(&path)?;
        if file_changed(&before, &after)
            || after.len() < before.len()
            || report.issues[first..].iter().any(|i| {
                matches!(
                    i.code.as_str(),
                    "sourceChanged" | "sourceUnreadable" | "resourceLimit"
                )
            })
        {
            return Err(crate::dto::operation_error(
                "SOURCE_CHANGED",
                "日志读取中发生变化，保留已提交数据并重试",
            ));
        }
        checkpoint.stamp = stamp(&before);
        checkpoint.boundary = boundary(Path::new(&path), checkpoint.offset)?;
        checkpoint.issues = report.issues.split_off(first);
    }
    for cp in checkpoints.values() {
        report.issues.extend(cp.issues.iter().cloned());
    }
    if let Some(versions) = previous.get("sourceVersions") {
        for v in serde_json::from_value::<Vec<String>>(versions.clone())? {
            if !report.source_versions.contains(&v) {
                report.source_versions.push(v);
            }
        }
    }
    // Persist unreconciled candidates. Derived reconciliation may retract old deltas.
    let full = rebuild || previous.is_empty() || facts.migrated != prior_migrations;
    let changed_operations = if full {
        None
    } else {
        Some(facts.dirty_operations.clone())
    };
    macro_rules! save {
        ($field:ident) => {
            crate::live_index::replace_field(
                db,
                &fact_scope,
                stringify!($field),
                facts.$field.iter().map(|(id, value)| (id.as_str(), value)),
            )?;
        };
    }
    save!(threads);
    save!(turns);
    if full {
        save!(measurements);
    } else {
        for id in &facts.dirty_measurements {
            crate::live_index::put(db, &fact_scope, "measurements", id, &facts.measurements[id])?;
        }
    }
    save!(parents);
    save!(migrated);
    save!(projects);
    crate::live_index::put(
        db,
        &fact_scope,
        "measurement_conflicts",
        "",
        &facts.measurement_conflicts,
    )?;
    if full {
        save!(operations);
        save!(aliases);
    } else {
        for id in &facts.dirty_operations {
            crate::live_index::put(db, &fact_scope, "operations", id, &facts.operations[id])?;
        }
        for id in &facts.dirty_aliases {
            crate::live_index::put(db, &fact_scope, "aliases", id, &facts.aliases[id])?;
        }
    }
    let metadata = serde_json::json!({"checkpoints": checkpoints, "missing": missing, "titleStamp": title_stamp, "sourceVersions": report.source_versions});
    crate::live_index::save_map(db, &scope, metadata.as_object().unwrap())?;
    let mut result = Collected::default();
    let derived = facts.fork_derived();
    cache.facts = Some(facts);
    finish_facts(derived, root, &mut report, &mut result);
    if !root.exists() && checkpoints.is_empty() {
        report.status = "notFound".into();
    } else if !report.issues.is_empty() {
        report.status = if report.files_read == 0
            && facts_empty_marker(&result)
            && report
                .issues
                .iter()
                .any(|i| matches!(i.code.as_str(), "invalidRecord" | "sourceUnreadable"))
        {
            "failed"
        } else {
            "partial"
        }
        .into();
    }
    result.issues.extend(report.issues.iter().cloned());
    result.sources.push(report);
    Ok(Some((result, changed_operations)))
}

fn facts_empty_marker(result: &Collected) -> bool {
    result.measurements.is_empty() && result.threads.is_empty()
}
