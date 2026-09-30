//! SQLite transaction boundary for resumable candidates and committed projections.
use anyhow::Result;
use rusqlite::{Connection, params};
use serde_json::{Map, Value};
use std::path::Path;

pub(crate) fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(2))?;
    db.execute_batch("PRAGMA page_size=16384; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS kv (scope TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,key)) WITHOUT ROWID;")?;
    Ok(db)
}
// Facts are stored as individual map entries, so an append does not rewrite old facts.
pub(crate) fn save_map(db: &Connection, scope: &str, map: &Map<String, Value>) -> Result<()> {
    save_fields(db, scope, map, true)
}
pub(crate) fn save_fields(
    db: &Connection,
    scope: &str,
    map: &Map<String, Value>,
    replace: bool,
) -> Result<()> {
    let mut desired = std::collections::BTreeSet::new();
    let mut insert = db.prepare_cached("INSERT INTO kv(scope,key,payload) VALUES(?1,?2,?3) ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload")?;
    for (field, value) in map {
        let entries: Vec<_> = match value.as_object() {
            Some(fields) => fields
                .iter()
                .map(|(key, value)| (serde_json::to_string(&(field, key)).unwrap(), value))
                .collect(),
            None => vec![(serde_json::to_string(&(field, "")).unwrap(), value)],
        };
        // Empty maps must remain maps after restart.
        let entries = if entries.is_empty() {
            vec![(serde_json::to_string(&(field, ""))?, value)]
        } else {
            entries
        };
        for (key, value) in entries {
            insert.execute(params![scope, key, serde_json::to_string(value)?])?;
            desired.insert(key);
        }
    }
    let mut old = Vec::new();
    if replace {
        old = db
            .prepare("SELECT key FROM kv WHERE scope=?1")?
            .query_map([scope], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
    } else {
        for field in map.keys() {
            let lower = format!("[{},", serde_json::to_string(field)?);
            let upper = format!("{lower}~");
            old.extend(
                db.prepare_cached("SELECT key FROM kv WHERE scope=?1 AND key>=?2 AND key<?3")?
                    .query_map(params![scope, lower, upper], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
    }
    for key in old {
        let (field, _): (String, String) = serde_json::from_str(&key)?;
        if !desired.contains(&key) && (replace || map.contains_key(&field)) {
            db.execute(
                "DELETE FROM kv WHERE scope=?1 AND key=?2",
                params![scope, key],
            )?;
        }
    }
    Ok(())
}
pub(crate) fn load_map(db: &Connection, scope: &str) -> Result<Map<String, Value>> {
    let mut result = Map::new();
    let mut statement = db.prepare("SELECT key,payload FROM kv WHERE scope=?1")?;
    let rows = statement.query_map([scope], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (key, value) = row?;
        let (field, id): (String, String) = serde_json::from_str(&key)?;
        let value = serde_json::from_str(&value)?;
        if id.is_empty() {
            result.insert(field, value);
        } else {
            result
                .entry(field)
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .unwrap()
                .insert(id, value);
        }
    }
    Ok(result)
}

pub(crate) fn put<T: serde::Serialize>(
    db: &Connection,
    scope: &str,
    field: &str,
    id: &str,
    value: &T,
) -> Result<()> {
    let key = serde_json::to_string(&(field, id))?;
    db.prepare_cached("INSERT INTO kv(scope,key,payload) VALUES(?1,?2,?3) ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload")?.execute(params![scope,key,serde_json::to_string(value)?])?;
    Ok(())
}

pub(crate) fn each(
    db: &Connection,
    scope: &str,
    mut consume: impl FnMut(&str, &str, &str) -> Result<()>,
) -> Result<bool> {
    let mut statement = db.prepare("SELECT key,payload FROM kv WHERE scope=?1")?;
    let mut rows = statement.query([scope])?;
    let mut found = false;
    while let Some(row) = rows.next()? {
        found = true;
        let key: String = row.get(0)?;
        let (field, id): (String, String) = serde_json::from_str(&key)?;
        let payload: String = row.get(1)?;
        if id.is_empty() && payload == "{}" {
            continue;
        }
        consume(&field, &id, &payload)?;
    }
    Ok(found)
}

// Serialize one safe fact at a time, without building a second JSON tree of the source.
pub(crate) fn replace_field<'a, T: serde::Serialize + 'a>(
    db: &Connection,
    scope: &str,
    field: &str,
    entries: impl IntoIterator<Item = (&'a str, &'a T)>,
) -> Result<()> {
    let mut desired = std::collections::BTreeSet::new();
    for (id, value) in entries {
        put(db, scope, field, id, value)?;
        desired.insert(serde_json::to_string(&(field, id))?);
    }
    if desired.is_empty() {
        put(db, scope, field, "", &serde_json::json!({}))?;
        desired.insert(serde_json::to_string(&(field, ""))?);
    }
    let lower = format!("[{},", serde_json::to_string(field)?);
    let upper = format!("{lower}~");
    let old: Vec<String> = db
        .prepare_cached("SELECT key FROM kv WHERE scope=?1 AND key>=?2 AND key<?3")?
        .query_map(params![scope, lower, upper], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for key in old {
        if !desired.contains(&key) {
            db.execute(
                "DELETE FROM kv WHERE scope=?1 AND key=?2",
                params![scope, key],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn remove(db: &Connection, scope: &str, field: &str, id: &str) -> Result<()> {
    db.prepare_cached("DELETE FROM kv WHERE scope=?1 AND key=?2")?
        .execute(params![scope, serde_json::to_string(&(field, id))?])?;
    Ok(())
}
