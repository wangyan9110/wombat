//! Durable review events reference immutable safe metadata, never source bodies.
use super::*;
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::{Map, Value};

const VERSION: i64 = 1;
const SCHEMA: &str = "CREATE TABLE review_parts(id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, payload BLOB NOT NULL);
CREATE TABLE review_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, object_id TEXT NOT NULL, suggestion_id TEXT NOT NULL, scope_project TEXT, status TEXT NOT NULL, category TEXT NOT NULL, basis INTEGER NOT NULL REFERENCES review_parts(id), item INTEGER NOT NULL REFERENCES review_parts(id), baseline INTEGER REFERENCES review_parts(id), event BLOB NOT NULL);
CREATE INDEX review_scope_seq ON review_events(scope_project,seq DESC);
CREATE INDEX review_scope_suggestion ON review_events(scope_project,suggestion_id,seq DESC);
CREATE INDEX review_scope_object ON review_events(scope_project,object_id,seq DESC);";

pub(super) fn initialize(db: &mut Connection) -> Result<()> {
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-4096; PRAGMA wal_autocheckpoint=512; PRAGMA journal_size_limit=8388608;")?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let version: i64 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == VERSION {
        tx.commit()?;
        return Ok(());
    }
    if version != 0 {
        return Err(operation_error(
            "REVIEWS_UNAVAILABLE",
            "处理记录版本不支持，原数据未被丢弃",
        ));
    }
    tx.execute_batch(SCHEMA)?;
    let legacy: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='decisions')",
        [],
        |r| r.get(0),
    )?;
    if legacy {
        let mut statement =
            tx.prepare("SELECT seq,object_id,suggestion_id,payload FROM decisions ORDER BY seq")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let suggestion: Suggestion =
                serde_json::from_str(row.get_ref(3)?.as_str()?).map_err(|_| {
                    operation_error("REVIEWS_UNAVAILABLE", "处理记录无法迁移，原数据未被丢弃")
                })?;
            if suggestion.item.id != row.get_ref(1)?.as_str()?
                || suggestion.id != row.get_ref(2)?.as_str()?
            {
                return Err(operation_error(
                    "REVIEWS_UNAVAILABLE",
                    "处理记录身份不一致，原数据未被丢弃",
                ));
            }
            write(&tx, &suggestion, Some(row.get(0)?))?;
        }
        drop(rows);
        drop(statement);
        tx.execute_batch("DROP TABLE decisions;")?;
    }
    tx.pragma_update(None, "user_version", VERSION)?;
    tx.commit()?;
    if legacy {
        db.execute_batch("VACUUM;")?;
    }
    Ok(())
}

fn part(tx: &Transaction<'_>, value: &Value) -> Result<i64> {
    let payload = serde_json::to_string(value)?;
    let hash = crate::hash(&payload);
    // The hash locates candidates; exact JSON bytes resolve even a collision.
    for salt in 0u64.. {
        let key = if salt == 0 {
            hash.clone()
        } else {
            format!("{hash}:{salt}")
        };
        let old: Option<(i64, String)> = tx
            .prepare_cached("SELECT id,json(payload) FROM review_parts WHERE hash=?1")?
            .query_row([&key], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        match old {
            Some((id, text)) if text == payload => return Ok(id),
            Some(_) => continue,
            None => {
                tx.prepare_cached("INSERT INTO review_parts(hash,payload) VALUES(?1,jsonb(?2))")?
                    .execute(params![key, payload])?;
                return Ok(tx.last_insert_rowid());
            }
        }
    }
    unreachable!()
}

fn category(value: &Category) -> &'static str {
    match value {
        Category::Repair => "repair",
        Category::Trim => "trim",
        Category::Organize => "organize",
        Category::Space => "space",
    }
}
fn write(tx: &Transaction<'_>, s: &Suggestion, seq: Option<i64>) -> Result<()> {
    let mut basis = serde_json::to_value(s)?.as_object().cloned().unwrap();
    let item = part(tx, &basis.remove("item").unwrap())?;
    let baseline = basis
        .remove("reviewBaseline")
        .filter(|v| !v.is_null())
        .map(|v| part(tx, &v))
        .transpose()?;
    let mut event = Map::new();
    for name in [
        "status",
        "checkedAt",
        "recordId",
        "recordedAt",
        "recheckRuleParameters",
    ] {
        if let Some(value) = basis.remove(name) {
            event.insert(name.into(), value);
        }
    }
    let basis = part(tx, &Value::Object(basis))?;
    tx.prepare_cached("INSERT INTO review_events(seq,object_id,suggestion_id,scope_project,status,category,basis,item,baseline,event) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,jsonb(?10))")?
        .execute(params![seq,s.item.id,s.id,s.scope_project,s.status,category(&s.category),basis,item,baseline,serde_json::to_string(&event)?])?;
    Ok(())
}

pub(super) fn append(tx: &Transaction<'_>, s: &mut Suggestion) -> Result<()> {
    let count: i64 = tx.query_row("SELECT COUNT(*) FROM review_events", [], |r| r.get(0))?;
    if count >= 20_000 {
        return Err(operation_error("RESOURCE_LIMIT", "处理记录达到上限"));
    }
    s.record_id = Some(uuid::Uuid::new_v4().to_string());
    s.recorded_at = Some(chrono::Utc::now().to_rfc3339());
    write(tx, s, None)
}
pub(super) fn revision(tx: &Transaction<'_>) -> Result<String> {
    Ok(tx
        .query_row("SELECT COALESCE(MAX(seq),0) FROM review_events", [], |r| {
            r.get::<_, i64>(0)
        })?
        .to_string())
}

pub(super) fn authorize<'a>(
    tx: &Transaction<'_>,
    ids: impl Iterator<Item = (&'a str, &'a str)>,
) -> Result<()> {
    tx.execute_batch(
        "CREATE TEMP TABLE authorized_review_objects(id TEXT PRIMARY KEY, physical_id TEXT NOT NULL) WITHOUT ROWID;",
    )?;
    let mut insert = tx.prepare("INSERT OR IGNORE INTO authorized_review_objects VALUES(?1,?2)")?;
    for (id, physical_id) in ids {
        insert.execute([id, physical_id])?;
    }
    Ok(())
}

#[derive(Debug)]
pub(super) struct State {
    pub seq: i64,
    pub status: String,
}
// Only lightweight latest metadata is scanned. History payloads stay on disk.
pub(super) fn states(
    tx: &Transaction<'_>,
    project: Option<&str>,
) -> Result<BTreeMap<String, State>> {
    let mut statement = tx.prepare("SELECT d.suggestion_id,d.seq,d.status FROM review_events d JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND NOT EXISTS(SELECT 1 FROM review_events newer WHERE newer.scope_project IS d.scope_project AND newer.suggestion_id=d.suggestion_id AND newer.seq>d.seq)")?;
    Ok(statement
        .query_map([project], |r| {
            Ok((
                r.get(0)?,
                State {
                    seq: r.get(1)?,
                    status: r.get(2)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?)
}
pub(super) fn rechecks(tx: &Transaction<'_>, project: Option<&str>) -> Result<Vec<i64>> {
    let mut statement = tx.prepare("SELECT d.seq FROM review_events d JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND d.status IN ('awaitingRecheck','recheckUnavailable','stillNeedsReview') AND NOT EXISTS(SELECT 1 FROM review_events newer JOIN authorized_review_objects next ON next.id=newer.object_id WHERE newer.scope_project IS d.scope_project AND next.physical_id=a.physical_id AND newer.seq>d.seq) ORDER BY d.seq")?;
    Ok(statement
        .query_map([project], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

const SELECT: &str = "SELECT json(b.payload),json(i.payload),json(base.payload),json(d.event) FROM review_events d JOIN review_parts b ON b.id=d.basis JOIN review_parts i ON i.id=d.item LEFT JOIN review_parts base ON base.id=d.baseline";
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<Suggestion> {
    let read = |n| -> Result<Value> { Ok(serde_json::from_str(row.get_ref(n)?.as_str()?)?) };
    let parsed = (|| -> Result<Suggestion> {
        let mut basis = read(0)?
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("invalid review basis"))?;
        basis.insert("item".into(), read(1)?);
        basis.insert(
            "reviewBaseline".into(),
            if matches!(row.get_ref(2)?, rusqlite::types::ValueRef::Null) {
                Value::Null
            } else {
                read(2)?
            },
        );
        basis.extend(
            read(3)?
                .as_object()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("invalid review event"))?,
        );
        Ok(serde_json::from_value(Value::Object(basis))?)
    })();
    parsed.map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, e.into())
    })
}
pub(super) fn get(tx: &Transaction<'_>, seq: i64) -> Result<Suggestion> {
    Ok(tx.query_row(&format!("{SELECT} WHERE d.seq=?1"), [seq], decode)?)
}
pub(super) fn baseline(tx: &Transaction<'_>, seq: i64) -> Result<Option<crate::config_dto::Item>> {
    let value: Option<String> = tx.query_row("SELECT json(p.payload) FROM review_events d LEFT JOIN review_parts p ON p.id=d.baseline WHERE d.seq=?1", [seq], |r| r.get(0))?;
    value.map(|v| Ok(serde_json::from_str(&v)?)).transpose()
}
pub(super) fn history_count(tx: &Transaction<'_>, project: Option<&str>) -> Result<usize> {
    Ok(tx.query_row("SELECT COUNT(*) FROM review_events d JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1", [project], |r| r.get::<_, i64>(0))? as usize)
}
pub(super) fn page(
    tx: &Transaction<'_>,
    r: &Request,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<Suggestion>)> {
    let filter = "JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND (?2 IS NULL OR d.category=?2) AND (?3 IS NULL OR d.suggestion_id=?3)";
    let category = r.category.as_ref().map(category);
    let target = if r.action == Action::Detail {
        r.suggestion_id.as_deref()
    } else {
        None
    };
    let total = tx.query_row(
        &format!("SELECT COUNT(*) FROM review_events d {filter}"),
        params![r.project, category, target],
        |r| r.get::<_, i64>(0),
    )? as usize;
    let mut statement = tx.prepare(&format!(
        "{SELECT} {filter} ORDER BY d.seq DESC LIMIT ?4 OFFSET ?5"
    ))?;
    let items = statement
        .query_map(
            params![r.project, category, target, limit as i64, offset as i64],
            decode,
        )?
        .collect::<rusqlite::Result<_>>()?;
    Ok((total, items))
}
