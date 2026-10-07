//! Restore committed facts one project at a time, prioritizing the visible project.
//! One read transaction binds every batch. Progress never seeds parser accounting.
use super::*;
use crate::live::{ProjectLoad, ProjectLoadState};
use std::collections::HashMap;

const ISSUE: &str = "projectRestoreIncomplete";
pub(crate) fn incomplete(snapshot: &Snapshot) -> bool {
    !snapshot.project_loads.is_empty()
        && snapshot
            .project_loads
            .iter()
            .any(|p| p.state != ProjectLoadState::Ready)
}
pub(crate) fn restore_projects(
    db: &rusqlite::Connection,
    key: &str,
    roots: &[String],
    priority: impl Fn() -> Option<String>,
    mut publish: impl FnMut(Arc<Snapshot>),
) -> Result<Option<Arc<Snapshot>>> {
    let read_tx = db.unchecked_transaction()?;
    let db = &read_tx;
    let prior = crate::live_index::load_map(db, &format!("view:{key}"))?;
    let Some(id) = prior.get("id").and_then(Value::as_str) else {
        return Ok(None);
    };
    let prices = crate::pricing_sync::current()?;
    if prior.get("prices").and_then(Value::as_str) != Some(&prices.catalog_hash) {
        return Ok(None);
    }
    let mut collected = Collected::default();
    let mut readers = vec![];
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
        let mut value = match load_collected_inner(db, &source.id, true)? {
            Some(value) => value,
            None if failure.is_some() => Collected::default(),
            None => return Ok(None),
        };
        if let Some(failure) = failure {
            value.issues = failure.issues.clone();
            value.sources = vec![failure];
            value.watermarks = serde_json::from_value(
                prior
                    .get("failureWatermarks")
                    .and_then(|v| v.get(&source.id))
                    .ok_or_else(|| anyhow::anyhow!("missing failure watermark observations"))?
                    .clone(),
            )?;
            validate_watermarks(&value.watermarks)?;
        }
        // Validate all current headers before building optional indexes or reading events.
        readers.push((
            source.id.clone(),
            crate::live_index::prepare_event_reader(db, &format!("projection:{}", source.id))?,
        ));
        collected.watermarks.extend(value.watermarks);
        collected.sources.extend(value.sources);
        collected.issues.extend(value.issues);
        collected.threads.extend(value.threads);
        collected.turns.extend(value.turns);
        collected.measurements.extend(value.measurements);
        collected.operations.extend(value.operations);
        collected
            .title_observations
            .extend(value.title_observations);
    }
    let owner: HashMap<_, _> = collected
        .threads
        .iter()
        .map(|t| (t.id.clone(), t.project.clone()))
        .collect();
    let mut groups: BTreeMap<Option<String>, Collected> = BTreeMap::new();
    for thread in &collected.threads {
        groups.entry(thread.project.clone()).or_default();
    }
    for fact in std::mem::take(&mut collected.measurements) {
        let project = fact
            .thread_id
            .as_deref()
            .and_then(|t| owner.get(t))
            .cloned()
            .flatten();
        groups.entry(project).or_default().measurements.push(fact);
    }
    for fact in std::mem::take(&mut collected.operations) {
        let project = owner.get(fact.thread_id.as_ref()).cloned().flatten();
        groups.entry(project).or_default().operations.push(fact);
    }
    for turn in std::mem::take(&mut collected.turns) {
        let project = owner.get(&turn.thread_id).cloned().flatten();
        groups.entry(project).or_default().turns.push(turn);
    }
    // This bucket also retains source-level discontinuities without a thread.
    if groups.is_empty() {
        groups.entry(None).or_default();
    }
    let mut progress: Vec<_> = groups
        .keys()
        .cloned()
        .map(|project| ProjectLoad {
            project,
            state: ProjectLoadState::Pending,
        })
        .collect();
    // Source controls can affect any project's timing. Load them before publishing a ready project.
    for (source, reader) in &readers {
        reader.each(db, &[], true, |id, payload| {
            let event: Arc<crate::session_events::Event> = serde_json::from_str(payload)?;
            anyhow::ensure!(
                event.id() == id
                    && event.position().source_instance_id.as_ref() == source.as_str()
                    && event.thread_id().is_none(),
                "stored source event identity mismatch"
            );
            collected.events.push(event);
            Ok(())
        })?;
    }
    let mut previous: Option<Arc<Snapshot>> = None;
    let mut strings = crate::session_events::EventStrings::default();
    while !groups.is_empty() {
        let project = next_project(&groups, priority());
        let mut batch = groups.remove(&project).expect("selected project exists");
        let threads: Vec<_> = owner
            .iter()
            .filter(|(_, p)| **p == project)
            .map(|(id, _)| id.as_str())
            .collect();
        for (source, reader) in &readers {
            reader.each(db, &threads, false, |id, payload| {
                let mut event: crate::session_events::Event = serde_json::from_str(payload)?;
                strings.share(&mut event);
                let event = Arc::new(event);
                anyhow::ensure!(
                    event.id() == id
                        && event.position().source_instance_id.as_ref() == source.as_str(),
                    "stored event identity mismatch"
                );
                if let Some(thread) = event.thread_id() {
                    anyhow::ensure!(
                        owner.get(thread) == Some(&project),
                        "stored event project ownership mismatch"
                    );
                }
                batch.events.push(event);
                Ok(())
            })?;
        }
        collected.measurements.extend(batch.measurements);
        collected.operations.extend(batch.operations);
        collected.turns.extend(batch.turns);
        collected.events.extend(batch.events);
        progress
            .iter_mut()
            .find(|p| p.project == project)
            .unwrap()
            .state = ProjectLoadState::Ready;
        let complete = groups.is_empty();
        let mut facts = collected.clone();
        if !complete {
            facts.threads.retain(|thread| {
                progress
                    .iter()
                    .any(|p| p.project == thread.project && p.state == ProjectLoadState::Ready)
            });
            let loaded: std::collections::HashSet<_> =
                facts.threads.iter().map(|t| t.id.as_str()).collect();
            facts
                .title_observations
                .retain(|observation| loaded.contains(observation.thread_id.as_str()));
            facts.issues.push(Issue {
                code: ISSUE.into(),
                message: "已加载的项目可以查看，其他项目正在依次加载".into(),
                source_instance_id: None,
                evidence: None,
            });
            for source in &mut facts.sources {
                if source.status == "complete" {
                    source.status = "partial".into();
                }
                source.issues.push(facts.issues.last().unwrap().clone());
            }
            let next = next_project(&groups, priority());
            progress
                .iter_mut()
                .find(|p| p.project == next)
                .unwrap()
                .state = ProjectLoadState::Loading;
        }
        let revision = if complete {
            id.to_owned()
        } else {
            format!("live:{key}:{}", uuid::Uuid::new_v4())
        };
        let mut snapshot = crate::usage_store::memory_project_batch(
            facts,
            revision,
            prices.clone(),
            previous.as_deref(),
        )?;
        snapshot.project_loads = if complete { vec![] } else { progress.clone() };
        if let Some(at) = prior.get("createdAt").and_then(Value::as_str) {
            snapshot.manifest.snapshot_ref.created_at = at.into();
        }
        // Completed partitions are shared; the next batch carries only its new events.
        collected.events.clear();
        let snapshot = Arc::new(snapshot);
        if !complete {
            publish(Arc::clone(&snapshot));
        }
        previous = Some(snapshot);
    }
    // Commit optional indexes only; the captured source projections remain unchanged.
    read_tx.commit()?;
    if let Some(snapshot) = &previous {
        publish(Arc::clone(snapshot));
    }
    Ok(previous)
}

fn next_project(
    groups: &BTreeMap<Option<String>, Collected>,
    preferred: Option<String>,
) -> Option<String> {
    if let Some(project) = preferred
        && groups.contains_key(&Some(project.clone()))
    {
        return Some(project);
    }
    groups
        .iter()
        .filter(|(project, _)| project.is_some())
        .min_by_key(|(project, facts)| {
            (facts.measurements.len() + facts.operations.len(), *project)
        })
        .map(|(project, _)| project.clone())
        .unwrap_or(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requested_project_is_readable_before_later_projects_without_changing_committed_facts() {
        let source = tempfile::tempdir().unwrap();
        let index = tempfile::tempdir().unwrap();
        fs::create_dir(source.path().join("sessions")).unwrap();
        for (name, project, tokens) in [("a", "/synthetic/a", 110), ("b", "/synthetic/b", 220)] {
            let rows = [
                json!({"type":"session_meta","payload":{"id":name,"cwd":project}}),
                json!({"type":"turn_context","payload":{"turn_id":"turn","model":"gpt-5.4"}}),
                json!({"type":"event_msg","payload":{"type":"token_usage_record","thread_id":name,"turn_id":"turn","response_id":"response","usage":{"input_tokens":tokens-10,"output_tokens":10,"total_tokens":tokens}}}),
            ];
            fs::write(
                source.path().join(format!("sessions/{name}.jsonl")),
                rows.iter()
                    .map(|v| v.to_string() + "\n")
                    .collect::<String>(),
            )
            .unwrap();
        }
        let roots = vec![source.path().to_string_lossy().into_owned()];
        let key = source_key(&roots);
        let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
        let committed = sync(&mut db, &key, &roots, false, None, &mut BTreeMap::new())
            .unwrap()
            .unwrap();
        let original = crate::live_index::load_map(&db, &format!("view:{key}")).unwrap();
        let mut batches = vec![];
        let restored = restore_projects(
            &db,
            &key,
            &roots,
            || Some("/synthetic/b".into()),
            |view| batches.push(view),
        )
        .unwrap()
        .unwrap();
        let first = &batches[0];
        assert!(incomplete(first));
        assert_eq!(first.manifest.threads.len(), 1);
        assert_eq!(
            first.manifest.threads[0].thread.project.as_deref(),
            Some("/synthetic/b")
        );
        assert_eq!(
            first
                .live_ledger()
                .unwrap()
                .iter()
                .map(|r| r.fact.tokens.total.unwrap())
                .sum::<u64>(),
            220
        );
        assert!(
            first
                .project_loads
                .iter()
                .any(|p| p.project.as_deref() == Some("/synthetic/a")
                    && p.state != ProjectLoadState::Ready)
        );
        assert!(first.manifest.sources.iter().all(|s| s.status == "partial"));
        let query = |project: &str| {
            serde_json::from_value(
                json!({"action":"usage","scope":{"allTime":true,"project":project}}),
            )
            .unwrap()
        };
        let ready = crate::usage_app::execute_snapshot(query("/synthetic/b"), first).unwrap();
        assert_eq!(ready.summary.tokens.total, Some(220));
        let pending = crate::usage_app::execute_snapshot(query("/synthetic/a"), first).unwrap_err();
        assert_eq!(
            pending
                .downcast_ref::<crate::dto::OperationError>()
                .unwrap()
                .code,
            "SYNC_PENDING"
        );
        assert_eq!(
            restored
                .live_ledger()
                .unwrap()
                .iter()
                .map(|r| r.fact.tokens.total.unwrap())
                .sum::<u64>(),
            330
        );
        assert_eq!(
            restored.events().unwrap().len(),
            committed.events().unwrap().len()
        );
        assert_eq!(
            serde_json::to_value(&restored.manifest.events).unwrap(),
            serde_json::to_value(&committed.manifest.events).unwrap()
        );
        let normalize = |snapshot: &Snapshot| {
            let mut manifest = serde_json::to_value(&snapshot.manifest).unwrap();
            for (field, key) in [("watermarks", "fileId"), ("threads", "thread")] {
                manifest[field]
                    .as_array_mut()
                    .unwrap()
                    .sort_by_key(|v| v[key].to_string());
            }
            manifest
        };
        assert_eq!(normalize(&restored), normalize(&committed));
        assert_eq!(
            crate::live_index::load_map(&db, &format!("view:{key}")).unwrap(),
            original
        );
        let changes = db.total_changes();
        restore_projects(&db, &key, &roots, || None, |_| {}).unwrap();
        assert_eq!(db.total_changes(), changes);
    }
}
