//! Durable review events reference immutable safe metadata, never source bodies.
use crate::{dto::operation_error, optimize_dto::*};
use anyhow::Result;
use rusqlite::Connection;
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const VERSION: i64 = 4;
const SCHEMA: &str = "CREATE TABLE review_parts(id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, payload BLOB NOT NULL);
CREATE TABLE review_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, object_id TEXT NOT NULL, suggestion_id TEXT NOT NULL, scope_project TEXT, status TEXT NOT NULL, decided INTEGER NOT NULL, kind TEXT NOT NULL, category TEXT NOT NULL, basis INTEGER NOT NULL REFERENCES review_parts(id), item INTEGER NOT NULL REFERENCES review_parts(id), baseline INTEGER REFERENCES review_parts(id), checks INTEGER NOT NULL REFERENCES review_parts(id), event BLOB NOT NULL);
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
            "UNSUPPORTED_VERSION",
            "处理记录版本不支持，原数据未被丢弃",
        ));
    }
    let occupied: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%')", [], |r| r.get(0))?;
    if occupied {
        return Err(crate::dto::operation_error(
            "REVIEWS_UNAVAILABLE",
            "处理记录格式不支持，原数据未被更改",
        ));
    }
    tx.execute_batch(SCHEMA)?;
    tx.pragma_update(None, "user_version", VERSION)?;
    tx.commit()?;
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
fn write(tx: &Transaction<'_>, s: &Suggestion) -> Result<()> {
    let mut basis = serde_json::to_value(s)?.as_object().cloned().unwrap();
    let item = part(tx, &basis.remove("item").unwrap())?;
    let checks = part(tx, &basis.remove("checks").unwrap())?;
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
        "decision",
        "recordKind",
    ] {
        if let Some(value) = basis.remove(name) {
            event.insert(name.into(), value);
        }
    }
    let basis = part(tx, &Value::Object(basis))?;
    let kind = match s
        .record_kind
        .as_ref()
        .expect("record kind set before persistence")
    {
        RecordKind::Observation => "observation",
        RecordKind::Decision => "decision",
        RecordKind::Recheck => "recheck",
        RecordKind::Redisplay => "redisplay",
    };
    tx.prepare_cached("INSERT INTO review_events(object_id,suggestion_id,scope_project,status,decided,kind,category,basis,item,baseline,checks,event) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,jsonb(?12))")?
        .execute(params![s.item.id,s.id,s.scope_project,s.status,s.decision.is_some(),kind,category(&s.category),basis,item,baseline,checks,serde_json::to_string(&event)?])?;
    Ok(())
}

pub(super) fn append(tx: &Transaction<'_>, s: &mut Suggestion, kind: RecordKind) -> Result<()> {
    let count: i64 = tx.query_row("SELECT COUNT(*) FROM review_events", [], |r| r.get(0))?;
    if count >= 20_000 {
        return Err(operation_error("RESOURCE_LIMIT", "处理记录达到上限"));
    }
    super::identity::capture(s);
    validate(s)?;
    s.record_id = Some(uuid::Uuid::new_v4().to_string());
    s.recorded_at = Some(chrono::Utc::now().to_rfc3339());
    s.record_kind = Some(kind);
    write(tx, s)
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
    pub decided: bool,
}
// Only lightweight latest metadata is scanned. History payloads stay on disk.
pub(super) fn states(
    tx: &Transaction<'_>,
    project: Option<&str>,
) -> Result<BTreeMap<String, State>> {
    let mut statement = tx.prepare("SELECT d.suggestion_id,d.seq,d.status,d.decided FROM review_events d JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND NOT EXISTS(SELECT 1 FROM review_events newer WHERE newer.scope_project IS d.scope_project AND newer.suggestion_id=d.suggestion_id AND newer.seq>d.seq)")?;
    Ok(statement
        .query_map([project], |r| {
            Ok((
                r.get(0)?,
                State {
                    seq: r.get(1)?,
                    status: r.get(2)?,
                    decided: r.get(3)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?)
}
const SELECT: &str = "SELECT json(b.payload),json(i.payload),json(base.payload),json(d.event),json(c.payload) FROM review_events d JOIN review_parts b ON b.id=d.basis JOIN review_parts i ON i.id=d.item JOIN review_parts c ON c.id=d.checks LEFT JOIN review_parts base ON base.id=d.baseline";
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<Suggestion> {
    let read = |n| -> Result<Value> { Ok(serde_json::from_str(row.get_ref(n)?.as_str()?)?) };
    let parsed = (|| -> Result<Suggestion> {
        let mut basis = read(0)?
            .as_object()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("invalid review basis"))?;
        match basis.get("reviewFormatVersion").and_then(Value::as_u64) {
            Some(1) => (),
            Some(_) => {
                return Err(operation_error(
                    "UNSUPPORTED_VERSION",
                    "处理记录版本不支持，原数据未被更改",
                ));
            }
            None => {
                return Err(operation_error(
                    "REVIEWS_CORRUPT",
                    "处理记录版本头缺失或无效，原数据未被更改",
                ));
            }
        }
        basis.insert("item".into(), read(1)?);
        basis.insert("checks".into(), read(4)?);
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
        let value = Value::Object(basis);
        check_headers(&value)?;
        let suggestion = serde_json::from_value(value)?;
        validate(&suggestion)?;
        Ok(suggestion)
    })();
    parsed.map_err(|e| {
        let error = e
            .downcast::<crate::dto::OperationError>()
            .unwrap_or_else(|_| crate::dto::OperationError {
                code: "REVIEWS_CORRUPT",
                message: "处理记录格式损坏，原数据未被更改".into(),
                details: None,
            });
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}
pub(super) fn get(tx: &Transaction<'_>, seq: i64) -> Result<Suggestion> {
    tx.query_row(&format!("{SELECT} WHERE d.seq=?1"), [seq], decode)
        .map_err(read_error)
}
pub(super) fn history_count(tx: &Transaction<'_>, project: Option<&str>) -> Result<usize> {
    Ok(tx.query_row("SELECT COUNT(*) FROM review_events d JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND d.kind!='observation'", [project], |r| r.get::<_, i64>(0))? as usize)
}
pub(super) fn page(
    tx: &Transaction<'_>,
    r: &Request,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<Suggestion>)> {
    let filter = "JOIN authorized_review_objects a ON a.id=d.object_id WHERE d.scope_project IS ?1 AND d.kind!='observation' AND (?2 IS NULL OR d.category=?2) AND (?3 IS NULL OR d.suggestion_id=?3)";
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
        .collect::<rusqlite::Result<_>>()
        .map_err(read_error)?;
    Ok((total, items))
}

fn read_error(error: rusqlite::Error) -> anyhow::Error {
    if let rusqlite::Error::FromSqlConversionFailure(_, _, inner) = &error
        && let Some(error) = inner.downcast_ref::<crate::dto::OperationError>()
    {
        return operation_error(error.code, error.message.clone());
    }
    operation_error("REVIEWS_CORRUPT", "处理记录无法读取，原数据未被更改")
}
fn validate(s: &Suggestion) -> Result<()> {
    let baseline = s
        .review_baseline
        .as_ref()
        .ok_or_else(|| operation_error("REVIEWS_CORRUPT", "原始检查基线缺失"))?;
    if s.review_format_version != 1
        || baseline.version != 1
        || s.decision.as_ref().is_some_and(|d| d.binding.version != 1)
        || s.findings.iter().any(|f| f.identity.version != 1)
        || s.checks
            .iter()
            .chain(&baseline.assessments)
            .any(|c| c.basis.version != 1 || c.findings.iter().any(|f| f.identity.version != 1))
    {
        return Err(operation_error(
            "UNSUPPORTED_VERSION",
            "检查依据版本不支持，原数据未被更改",
        ));
    }
    if baseline.assessments.is_empty()
        || s.checks.is_empty()
        || baseline.scope != baseline.assessments[0].basis.scope
        || s.checks.iter().chain(&baseline.assessments).any(|c| {
            c.assessment_id.is_none() && c.identity_gap.is_none()
                || c.basis.dependency_revision.is_none() && c.basis.gaps.is_empty()
                || c.findings
                    .iter()
                    .any(|f| f.identity.finding_id.is_none() && f.identity.gap.is_none())
        })
    {
        return Err(operation_error(
            "REVIEWS_CORRUPT",
            "检查依据格式损坏，原数据未被更改",
        ));
    }
    Ok(())
}

fn required_version(value: &Value, name: &str) -> Result<()> {
    match value.get(name).and_then(Value::as_u64) {
        Some(1) => Ok(()),
        Some(_) => Err(operation_error(
            "UNSUPPORTED_VERSION",
            "检查依据版本不支持，原数据未被更改",
        )),
        None => Err(operation_error(
            "REVIEWS_CORRUPT",
            "检查依据版本头缺失或无效，原数据未被更改",
        )),
    }
}
fn check_headers(value: &Value) -> Result<()> {
    required_version(value, "reviewFormatVersion")?;
    let baseline = &value["reviewBaseline"];
    required_version(baseline, "version")?;
    if !value["decision"].is_null() {
        required_version(&value["decision"]["binding"], "version")?;
    }
    let check_findings = |findings: &Value| -> Result<()> {
        let findings = findings
            .as_array()
            .ok_or_else(|| operation_error("REVIEWS_CORRUPT", "问题记录格式损坏"))?;
        for finding in findings {
            required_version(&finding["identity"], "version")?;
        }
        Ok(())
    };
    check_findings(&value["findings"])?;
    for checks in [&value["checks"], &baseline["assessments"]] {
        let checks = checks
            .as_array()
            .ok_or_else(|| operation_error("REVIEWS_CORRUPT", "检查记录格式损坏"))?;
        for check in checks {
            required_version(&check["basis"], "version")?;
            check_findings(&check["findings"])?;
        }
    }
    Ok(())
}
