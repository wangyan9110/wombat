//! Compact live snapshots share immutable facts and index turn membership.
use super::*;
pub(crate) fn memory(
    collected: Collected,
    id: String,
    prices: crate::pricing_sync::Response,
    prior: Option<&Snapshot>,
) -> Result<Snapshot> {
    let mut pool = super::price_pool::PricePool::new(&prices);
    let reusable = prior
        .filter(|s| s.manifest.price_catalog_hash == prices.catalog_hash)
        .and_then(|s| s.live_rows.as_ref());
    let mut facts = collected.measurements;
    facts.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    let mut previous = reusable.into_iter().flatten().peekable();
    let mut rows = Vec::with_capacity(facts.len());
    let mut memory_turns: BTreeMap<(String, String), MemoryTurn> = BTreeMap::new();
    for fact in facts {
        while previous.peek().is_some_and(|r| r.fact.id < fact.id) {
            previous.next();
        }
        let prior = previous
            .peek()
            .copied()
            .filter(|r| r.fact.id == fact.id)
            .filter(|r| Arc::ptr_eq(&r.fact, &fact) || r.fact == fact);
        let row = match prior {
            Some(row) => {
                pool.remember(&row.fact, &row.price);
                Arc::clone(row)
            }
            None => {
                let price = pool.price(&fact);
                Arc::new(PricedMeasurement { fact, price })
            }
        };
        rows.push(row);
    }
    drop(pool);

    if rows
        .windows(2)
        .any(|pair| pair[0].fact.id == pair[1].fact.id)
    {
        return Err(operation_error("INVALID_FACTS", "计量身份重复"));
    }
    for (index, row) in rows.iter().enumerate() {
        if let Some(thread) = &row.fact.thread_id {
            memory_turns
                .entry((
                    thread.to_string(),
                    row.fact
                        .turn_id
                        .as_deref()
                        .unwrap_or("unassigned")
                        .to_owned(),
                ))
                .or_default()
                .measurements
                .push(index);
        }
    }
    crate::usage_app::summarize(&rows.iter().map(Arc::as_ref).collect::<Vec<_>>())?;
    for op in collected.operations {
        memory_turns
            .entry((
                op.thread_id.to_string(),
                op.turn_id.as_deref().unwrap_or("unassigned").to_owned(),
            ))
            .or_default()
            .operations
            .push(op);
    }
    let turns: BTreeMap<_, _> = collected
        .turns
        .into_iter()
        .map(|t| ((t.thread_id.clone(), t.id.clone()), t))
        .collect();
    for key in turns.keys() {
        memory_turns.entry(key.clone()).or_default();
    }
    let mut by_thread: BTreeMap<String, BTreeMap<String, TurnEntry>> = BTreeMap::new();
    for (thread, turn) in memory_turns.keys() {
        by_thread.entry(thread.to_string()).or_default().insert(
            turn.clone(),
            TurnEntry {
                turn: turns.get(&(thread.to_string(), turn.clone())).cloned(),
                slice: Slice {
                    offset: 0,
                    length: 0,
                    sha256: String::new(),
                },
            },
        );
    }
    let threads = collected
        .threads
        .into_iter()
        .map(|thread| {
            let turns = by_thread.remove(&thread.id).unwrap_or_default();
            ThreadEntry {
                thread,
                turns,
                file: file_ref("live", &[]),
            }
        })
        .collect();
    if !by_thread.is_empty() {
        return Err(operation_error("INVALID_FACTS", "存在没有对话元数据的记录"));
    }
    super::events::validate(&collected.events)?;
    let manifest = Manifest {
        schema_version: 4,
        snapshot_ref: SnapshotRef {
            snapshot_id: id,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        price_revision: prices.catalog.revision,
        price_catalog_hash: prices.catalog_hash,
        sources: collected.sources,
        issues: collected.issues,
        ledger: file_ref("live", &[]),
        events: file_ref("live", &[]),
        threads,
    };
    Ok(Snapshot {
        query_cache: Mutex::default(),
        manifest,
        directory: PathBuf::new(),
        live_rows: Some(rows),
        live_events: Some(collected.events),
        memory_turns: Some(memory_turns),
    })
}
