//! Durable parser checkpoints contain allowlisted facts only, never event bodies.
use super::*;
use anyhow::Result;
mod projection;
use rusqlite::Connection;

use std::time::UNIX_EPOCH;

#[derive(Default, Serialize, Deserialize)]
pub(super) struct Checkpoint {
    pub offset: u64,
    pub line: u64,
    pub state: State,
    stamp: String,
    physical: String,
    boundary: String,
    issues: Vec<Issue>,
}

pub(super) fn physical_identity(meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    let physical = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let physical = format!("{:?}", meta.created().ok());
    physical
}
fn stamp(meta: &fs::Metadata) -> String {
    let physical = physical_identity(meta);
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
    projected: Option<Vec<Arc<Measurement>>>,
    seed: Option<ReusableFacts>,
}

struct ReusableFacts {
    measurements: Vec<Arc<Measurement>>,
    operations: Vec<Arc<Operation>>,
}

impl Cache {
    pub(crate) fn projection<'a>(
        &'a self,
        db: &'a Connection,
        source: &SourceInstance,
        scope: &str,
    ) -> Result<projection::Projection<'a>> {
        projection::Projection::new(self, db, source, scope)
    }
    pub(crate) fn needs_seed(&self) -> bool {
        self.facts.is_none() && self.seed.is_none()
    }
    pub(crate) fn seed(
        &mut self,
        measurements: Vec<Arc<Measurement>>,
        mut operations: Vec<Arc<Operation>>,
    ) {
        operations.sort_unstable_by(|a, b| a.id.cmp(&b.id));
        self.seed = Some(ReusableFacts {
            measurements,
            operations,
        });
    }
    pub(crate) fn share_measurements<'a>(
        &mut self,
        rows: impl Iterator<Item = &'a Arc<Measurement>>,
    ) {
        // Candidates, projected facts and caller rows are ID-sorted. Merge
        // them without a tree lookup and binary search for every ledger row.
        let Some(facts) = &mut self.facts else {
            return;
        };
        let mut rows = rows.peekable();
        let projected = self.projected.as_deref_mut().unwrap_or_default();
        let mut index = 0;
        for (id, candidate) in &mut facts.measurements {
            while rows.peek().is_some_and(|row| row.id < *id) {
                rows.next();
            }
            let Some(row) = rows.peek().copied().filter(|row| row.id == *id) else {
                continue;
            };
            if !Arc::ptr_eq(&candidate.measurement, row) && candidate.measurement == *row {
                candidate.measurement = Arc::clone(row);
            }
            while projected.get(index).is_some_and(|value| value.id < *id) {
                index += 1;
            }
            if let Some(value) = projected.get_mut(index)
                && value.id == *id
                && !Arc::ptr_eq(value, row)
                && *value == *row
            {
                *value = Arc::clone(row);
            }
        }
    }
}

fn fact_scope(source: &SourceInstance) -> String {
    format!("parser:{}:{VERSION}:1:facts", source.id)
}

#[cfg(test)]
pub(crate) fn sync(
    db: &Connection,
    source: &SourceInstance,
    verify: bool,
) -> Result<Option<Collected>> {
    Ok(sync_cached(db, source, verify, &mut Cache::default())?.map(|value| value.collected))
}

fn load_facts(
    db: &Connection,
    scope: &str,
    reuse: Option<&ReusableFacts>,
    report: &SourceReport,
) -> Result<Facts> {
    let mut events = BTreeMap::new();
    crate::live_index::each(db, scope, |field, id, payload| {
        if field == "events" {
            let event: Arc<crate::session_events::Event> = serde_json::from_str(payload)?;
            anyhow::ensure!(event.id() == id, "stored event identity mismatch");
            anyhow::ensure!(
                event.position().source_instance_id == report.source.id,
                "stored event source identity mismatch"
            );
            events.insert(id.into(), event);
        } else {
            anyhow::ensure!(
                matches!(
                    field,
                    "threads"
                        | "turns"
                        | "measurements"
                        | "operations"
                        | "aliases"
                        | "parents"
                        | "projects"
                        | "measurement_conflicts"
                ),
                "unsupported fact field: {field}"
            );
        }
        Ok(())
    })?;
    let mut facts = replay_events(events, report);
    // Read projections may share allocations, but never establish parser facts.
    let mut paths = EvidencePaths::default();
    for (id, candidate) in &mut facts.measurements {
        if let Some(rows) = reuse.map(|r| &r.measurements)
            && let Ok(index) = rows.binary_search_by(|r| r.id.as_str().cmp(id))
            && rows[index] == candidate.measurement
        {
            candidate.measurement = Arc::clone(&rows[index]);
        }
        if Arc::strong_count(&candidate.measurement) == 1 {
            let row = Arc::make_mut(&mut candidate.measurement);
            paths.compact(&mut row.evidence);
            facts.strings.measurement(row);
        }
    }
    for (id, operation) in &mut facts.operations {
        if let Some(rows) = reuse.map(|r| &r.operations)
            && let Ok(index) = rows.binary_search_by(|r| r.id.as_str().cmp(id))
            && rows[index] == *operation
        {
            *operation = Arc::clone(&rows[index]);
        }
        if Arc::strong_count(operation) == 1 {
            let row = Arc::make_mut(operation);
            paths.compact(&mut row.evidence);
            facts.strings.operation(row);
        }
    }
    Ok(facts)
}

fn replay_events(
    events: BTreeMap<String, Arc<crate::session_events::Event>>,
    report: &SourceReport,
) -> Facts {
    let mut facts = Facts::default();
    // Parse diagnostics remain owned by file checkpoints; replay only restores facts.
    let mut replay_report = report.clone();
    replay_report.issues.clear();
    let mut ordered: Vec<_> = events.values().collect();
    ordered.sort_by(|a, b| event_projection::order(a).cmp(&event_projection::order(b)));
    for event in ordered {
        event_projection::apply(&mut facts, event, &mut replay_report);
    }
    facts.events = events;
    facts
}

pub(crate) struct MeasurementDelta {
    pub upsert: Vec<Arc<Measurement>>,
    pub remove: Vec<String>,
}
pub(crate) struct Synced {
    pub collected: Collected,
    pub operations: Option<BTreeSet<String>>,
    pub measurements: Option<MeasurementDelta>,
}
// Both lists are ID-sorted; reconcile inserts, corrections and retractions in one pass.
fn projection_delta(old: &[Arc<Measurement>], new: &[Arc<Measurement>]) -> MeasurementDelta {
    let mut delta = MeasurementDelta {
        upsert: vec![],
        remove: vec![],
    };
    let (mut left, mut right) = (0, 0);
    while left < old.len() || right < new.len() {
        match (old.get(left), new.get(right)) {
            (Some(a), Some(b)) => match a.id.cmp(&b.id) {
                std::cmp::Ordering::Less => {
                    delta.remove.push(a.id.clone());
                    left += 1;
                }
                std::cmp::Ordering::Greater => {
                    delta.upsert.push(Arc::clone(b));
                    right += 1;
                }
                std::cmp::Ordering::Equal => {
                    if !Arc::ptr_eq(a, b) && a != b {
                        delta.upsert.push(Arc::clone(b));
                    }
                    left += 1;
                    right += 1;
                }
            },
            (Some(a), None) => {
                delta.remove.push(a.id.clone());
                left += 1;
            }
            (None, Some(b)) => {
                delta.upsert.push(Arc::clone(b));
                right += 1;
            }
            (None, None) => break,
        }
    }
    delta
}
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
    let mut replaced = BTreeSet::new();
    for file in &files {
        let key = file.to_string_lossy().into_owned();
        let meta = fs::metadata(file)?;
        if let Some(cp) = checkpoints.get(&key) {
            if cp.stamp == stamp(&meta) && !verify {
                continue;
            }
            if physical_identity(&meta) != cp.physical
                || meta.len() < cp.offset
                || boundary(file, cp.offset).ok().as_ref() != Some(&cp.boundary)
                || (meta.len() == cp.offset && cp.stamp != stamp(&meta))
            {
                rebuild = true;
                replaced.insert(key.clone());
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
                file: path.as_str().into(),
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
    let restoring = cache.facts.is_none();
    let mut facts = match cache.facts.take() {
        Some(facts) => facts,
        None => load_facts(db, &fact_scope, cache.seed.as_ref(), &report)?,
    };
    cache.seed = None;
    facts.dirty_events.clear();
    facts.dirty_operations.clear();
    facts.dirty_measurements.clear();
    facts.dirty_aliases.clear();
    let generations: BTreeMap<_, _> = checkpoints
        .iter()
        .filter_map(|(path, cp)| {
            cp.state
                .event_generation
                .clone()
                .map(|generation| (path.clone(), generation))
        })
        .collect();
    if rebuild {
        // Cross-file ownership and late direct measurements require source-wide
        // reconciliation. Retain facts evidenced solely by now-missing files.
        let missing_files: BTreeSet<_> =
            missing.iter().map(|p| crate::hash(p.as_bytes())).collect();
        facts
            .events
            .retain(|_, event| missing_files.contains(&event.position().file_id));
        facts = replay_events(std::mem::take(&mut facts.events), &report);
        checkpoints.retain(|p, _| missing.contains(p));
        dirty = files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
    }
    for path in dirty {
        let checkpoint = checkpoints.entry(path.clone()).or_default();
        if checkpoint.state.event_generation.is_none() {
            checkpoint.state.event_generation = if replaced.contains(&path) {
                Some(uuid::Uuid::new_v4().to_string())
            } else {
                generations.get(&path).cloned()
            };
        }
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
        checkpoint.physical = physical_identity(&before);
        checkpoint.boundary = boundary(Path::new(&path), checkpoint.offset)?;
        checkpoint.issues = report.issues.split_off(first);
    }
    if rebuild {
        // Missing files were retained before existing files were parsed. Restore
        // their combined source order before publishing or saving projections.
        // Checkpoints already own diagnostics; replay must not append them again.
        facts = replay_events(std::mem::take(&mut facts.events), &report);
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
    // Events restore parser truth; refresh disposable projection rows on restart,
    // including references whose cached payload may have been discarded.
    let full = rebuild || previous.is_empty() || restoring;
    let changed_operations = if full || !facts.parents.is_empty() {
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
    if full {
        save!(events);
    } else {
        for id in &facts.dirty_events {
            crate::live_index::put(db, &fact_scope, "events", id, &facts.events[id])?;
        }
    }
    facts.dirty_events.clear();
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
    facts.dirty_measurements.clear();
    facts.dirty_operations.clear();
    facts.dirty_aliases.clear();
    let mut result = Collected::default();
    // Direct response records require no cumulative/fork reconciliation. Preserve
    // the general path for cumulative source counters.
    let direct_only = facts.parents.is_empty() && facts.measurements.values().all(|v| v.direct);
    let derived = facts.fork_derived(!direct_only);
    finish_facts(derived, root, &mut report, &mut result);
    if direct_only {
        result.measurements.extend(
            facts
                .measurements
                .values()
                .map(|v| Arc::clone(&v.measurement)),
        );
        result.operations.extend(facts.operations.values().cloned());
    }
    cache.facts = Some(facts);
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
    result.measurements.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let measurements = cache
        .projected
        .as_ref()
        .map(|old| projection_delta(old, &result.measurements));
    cache.projected = Some(result.measurements.clone());
    Ok(Some(Synced {
        collected: result,
        operations: changed_operations,
        measurements,
    }))
}

fn facts_empty_marker(result: &Collected) -> bool {
    result.measurements.is_empty() && result.threads.is_empty()
}

#[cfg(test)]
mod sharing_tests {
    use super::*;
    fn row(id: &str, total: u64) -> Arc<Measurement> {
        Arc::new(serde_json::from_value(serde_json::json!({"id":id,"agentKind":"synthetic","sourceInstanceId":"s","grain":"response","timePrecision":"unknown","model":{},"tokens":{"total":total},"requestScoped":true,"sequence":0,"evidence":[]})).unwrap())
    }
    #[test]
    fn ordered_sharing_preserves_corrections_missing_and_foreign_facts() {
        let b = row("b", 1);
        let d = row("d", 2);
        let f = row("f", 1);
        let z = row("z", 1);
        let facts = Facts {
            measurements: [b.clone(), d.clone(), f.clone(), z.clone()]
                .into_iter()
                .map(|measurement| {
                    (
                        measurement.id.clone(),
                        Candidate {
                            measurement,
                            direct: true,
                            cumulative: None,
                            interval_start: None,
                            fingerprint: String::new(),
                        },
                    )
                })
                .collect(),
            ..Facts::default()
        };
        let orphan = row("c", 1);
        let mut cache = Cache {
            facts: Some(facts),
            projected: Some(vec![
                b.clone(),
                orphan.clone(),
                d.clone(),
                f.clone(),
                z.clone(),
            ]),
            seed: None,
        };
        let rows = [
            row("a", 1),
            row("b", 1),
            row("d", 3),
            row("e", 1),
            row("f", 1),
            row("g", 1),
        ];
        cache.share_measurements(rows.iter());
        let facts = &cache.facts.as_ref().unwrap().measurements;
        let projected = cache.projected.as_ref().unwrap();
        assert!(Arc::ptr_eq(&facts["b"].measurement, &rows[1]));
        assert!(Arc::ptr_eq(&projected[0], &rows[1]));
        assert!(Arc::ptr_eq(&facts["d"].measurement, &d));
        assert!(Arc::ptr_eq(&projected[2], &d));
        assert!(Arc::ptr_eq(&facts["f"].measurement, &rows[4]));
        assert!(Arc::ptr_eq(&projected[3], &rows[4]));
        assert!(Arc::ptr_eq(&facts["z"].measurement, &z));
        assert!(Arc::ptr_eq(&projected[4], &z));
        assert!(Arc::ptr_eq(&projected[1], &orphan));
        cache.share_measurements(rows.iter());
        assert_eq!(cache.facts.as_ref().unwrap().measurements.len(), 4);
        let mut empty = Cache::default();
        empty.share_measurements(rows.iter());
    }
}
