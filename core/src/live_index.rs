//! SQLite transaction boundary for resumable candidates and committed projections.
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};
use std::{collections::HashSet, path::Path};

const VERSION: i64 = 2;
const UPSERT: &str = "INSERT INTO entries(bucket,id,payload) VALUES(?1,?2,jsonb(?3)) ON CONFLICT(bucket,id) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload";

pub(crate) fn failure_code(error: &anyhow::Error) -> &'static str {
    if let Some(e) = error.downcast_ref::<crate::dto::OperationError>() {
        return e.code;
    }
    if let Some(rusqlite::Error::SqliteFailure(e, _)) = error.downcast_ref::<rusqlite::Error>() {
        return match e.code {
            rusqlite::ErrorCode::DiskFull => "STORAGE_FULL",
            rusqlite::ErrorCode::CannotOpen
            | rusqlite::ErrorCode::ReadOnly
            | rusqlite::ErrorCode::PermissionDenied
            | rusqlite::ErrorCode::SystemIoFailure => "STORAGE_UNAVAILABLE",
            _ => "INDEX_UNAVAILABLE",
        };
    }
    "SOURCE_UNREADABLE"
}

pub(crate) fn open(path: &Path) -> Result<Connection> {
    open_inner(path).map_err(|error| {
        let code = failure_code(&error);
        if error.downcast_ref::<crate::dto::OperationError>().is_some() {
            error
        } else {
            crate::dto::operation_error(code, error.to_string())
        }
    })
}
fn open_inner(path: &Path) -> Result<Connection> {
    let mut db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(2))?;
    db.execute_batch("PRAGMA page_size=16384; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-4096; PRAGMA temp_store=FILE; PRAGMA journal_size_limit=8388608; PRAGMA wal_autocheckpoint=512;")?;
    let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == VERSION {
        return Ok(db);
    }
    if version != 0 {
        return Err(crate::dto::operation_error(
            "INDEX_UNSUPPORTED_VERSION",
            format!("unsupported live index schema: {version}"),
        ));
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Another connection may have completed initialization while we waited.
    let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == VERSION {
        tx.commit()?;
        return Ok(db);
    }
    if version != 0 {
        return Err(crate::dto::operation_error(
            "INDEX_UNSUPPORTED_VERSION",
            format!("unsupported live index schema: {version}"),
        ));
    }
    tx.execute_batch("CREATE TABLE buckets (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, field TEXT NOT NULL, UNIQUE(scope,field));
        CREATE TABLE entries (bucket INTEGER NOT NULL REFERENCES buckets(id), id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(bucket,id)) WITHOUT ROWID;")?;
    let legacy: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='kv')",
        [],
        |r| r.get(0),
    )?;
    if legacy {
        // Stream one legacy record at a time. Any invalid key/payload rolls back
        // the entire migration, leaving the old index available for inspection.
        let mut statement = tx.prepare("SELECT scope,key,payload FROM kv")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let scope: String = row.get(0)?;
            let key: String = row.get(1)?;
            let payload: String = row.get(2)?;
            let (field, id): (String, String) = serde_json::from_str(&key).map_err(|_| {
                crate::dto::operation_error(
                    "INDEX_MIGRATION_FAILED",
                    "旧索引键无法迁移，旧索引未被丢弃",
                )
            })?;
            write(&tx, bucket(&tx, &scope, &field)?, &id, &payload).map_err(|error| {
                let code = failure_code(&error);
                crate::dto::operation_error(
                    if code == "STORAGE_FULL" || code == "STORAGE_UNAVAILABLE" {
                        code
                    } else {
                        "INDEX_MIGRATION_FAILED"
                    },
                    "旧索引迁移未完成，原索引事务已回滚",
                )
            })?;
        }
        drop(rows);
        drop(statement);
        tx.execute_batch("DROP TABLE kv;")?;
    }
    tx.pragma_update(None, "user_version", VERSION)?;
    tx.commit()?;
    if legacy {
        // One-time migration compaction, never on append or ordinary startup.
        // VACUUM is itself atomic; failure cannot discard committed facts.
        db.execute_batch("VACUUM;")?;
    }
    Ok(db)
}

fn bucket(db: &Connection, scope: &str, field: &str) -> Result<i64> {
    db.prepare_cached(
        "INSERT INTO buckets(scope,field) VALUES(?1,?2) ON CONFLICT(scope,field) DO NOTHING",
    )?
    .execute(params![scope, field])?;
    Ok(db
        .prepare_cached("SELECT id FROM buckets WHERE scope=?1 AND field=?2")?
        .query_row(params![scope, field], |row| row.get(0))?)
}
fn write(db: &Connection, bucket: i64, id: &str, payload: &str) -> Result<()> {
    db.prepare_cached(UPSERT)?
        .execute(params![bucket, id, payload])?;
    Ok(())
}

// Desired IDs borrow existing facts; only obsolete IDs are copied for deletion.
// Finish SELECT before DELETE: mutating a table during its scan is unspecified.
fn prune(db: &Connection, bucket: i64, desired: &HashSet<&str>) -> Result<()> {
    let mut obsolete = Vec::new();
    {
        let mut statement = db.prepare_cached("SELECT id FROM entries WHERE bucket=?1")?;
        let mut rows = statement.query([bucket])?;
        while let Some(row) = rows.next()? {
            let id = row.get_ref(0)?.as_str()?;
            if !desired.contains(id) {
                obsolete.push(id.to_owned());
            }
        }
    }
    let mut delete = db.prepare_cached("DELETE FROM entries WHERE bucket=?1 AND id=?2")?;
    for id in obsolete {
        delete.execute(params![bucket, id])?;
    }
    Ok(())
}

pub(crate) fn save_map(db: &Connection, scope: &str, map: &Map<String, Value>) -> Result<()> {
    save_fields(db, scope, map, true)
}
pub(crate) fn save_fields(
    db: &Connection,
    scope: &str,
    map: &Map<String, Value>,
    replace: bool,
) -> Result<()> {
    for (field, value) in map {
        let bucket = bucket(db, scope, field)?;
        let mut desired = HashSet::new();
        match value.as_object().filter(|fields| !fields.is_empty()) {
            Some(fields) => {
                for (id, value) in fields {
                    write(db, bucket, id, &serde_json::to_string(value)?)?;
                    desired.insert(id.as_str());
                }
            }
            None => {
                write(db, bucket, "", &serde_json::to_string(value)?)?;
                desired.insert("");
            }
        }
        prune(db, bucket, &desired)?;
    }
    if replace {
        let mut obsolete = Vec::new();
        {
            let mut statement = db.prepare_cached("SELECT id,field FROM buckets WHERE scope=?1")?;
            let mut rows = statement.query([scope])?;
            while let Some(row) = rows.next()? {
                if !map.contains_key(row.get_ref(1)?.as_str()?) {
                    obsolete.push(row.get::<_, i64>(0)?);
                }
            }
        }
        for bucket in obsolete {
            db.execute("DELETE FROM entries WHERE bucket=?1", [bucket])?;
        }
    }
    Ok(())
}
pub(crate) fn load_map(db: &Connection, scope: &str) -> Result<Map<String, Value>> {
    let mut result = Map::new();
    each_row(db, scope, |field, id, payload| {
        let value = serde_json::from_str(payload)?;
        if id.is_empty() {
            result.insert(field.into(), value);
        } else {
            result
                .entry(field)
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("mixed scalar/map index field: {field}"))?
                .insert(id.into(), value);
        }
        Ok(())
    })?;
    Ok(result)
}

pub(crate) fn put<T: serde::Serialize>(
    db: &Connection,
    scope: &str,
    field: &str,
    id: &str,
    value: &T,
) -> Result<()> {
    write(
        db,
        bucket(db, scope, field)?,
        id,
        &serde_json::to_string(value)?,
    )
}

pub(crate) fn each(
    db: &Connection,
    scope: &str,
    mut consume: impl FnMut(&str, &str, &str) -> Result<()>,
) -> Result<bool> {
    each_row(db, scope, |field, id, payload| {
        if !(id.is_empty() && payload == "{}") {
            consume(field, id, payload)?;
        }
        Ok(())
    })
}

fn each_row(
    db: &Connection,
    scope: &str,
    mut consume: impl FnMut(&str, &str, &str) -> Result<()>,
) -> Result<bool> {
    let mut statement = db.prepare_cached("SELECT b.field,e.id,json(e.payload) FROM buckets b JOIN entries e ON e.bucket=b.id WHERE b.scope=?1")?;
    let mut rows = statement.query([scope])?;
    let mut found = false;
    while let Some(row) = rows.next()? {
        found = true;
        let field = row.get_ref(0)?.as_str()?;
        let id = row.get_ref(1)?.as_str()?;
        let payload = row.get_ref(2)?.as_str()?;
        consume(field, id, payload)?;
    }
    Ok(found)
}

pub(crate) fn replace_field<'a, T: serde::Serialize + 'a>(
    db: &Connection,
    scope: &str,
    field: &str,
    entries: impl IntoIterator<Item = (&'a str, &'a T)>,
) -> Result<()> {
    let bucket = bucket(db, scope, field)?;
    let mut desired = HashSet::new();
    for (id, value) in entries {
        write(db, bucket, id, &serde_json::to_string(value)?)?;
        desired.insert(id);
    }
    if desired.is_empty() {
        write(db, bucket, "", "{}")?;
        desired.insert("");
    }
    prune(db, bucket, &desired)
}

pub(crate) fn remove(db: &Connection, scope: &str, field: &str, id: &str) -> Result<()> {
    let bucket: Option<i64> = db
        .prepare_cached("SELECT id FROM buckets WHERE scope=?1 AND field=?2")?
        .query_row(params![scope, field], |r| r.get(0))
        .optional()?;
    if let Some(bucket) = bucket {
        db.prepare_cached("DELETE FROM entries WHERE bucket=?1 AND id=?2")?
            .execute(params![bucket, id])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn legacy(path: &Path, key: &str, payload: &str) {
        let db = Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE kv(scope TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,key)) WITHOUT ROWID;").unwrap();
        db.execute("INSERT INTO kv VALUES('old',?1,?2)", params![key, payload])
            .unwrap();
    }

    #[test]
    fn legacy_migration_preserves_exact_values_and_reopens() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("index.sqlite");
        let value = json!({"int":u64::MAX,"negative":i64::MIN,"float":1.23456789012345e-250,"unicode":"😀中文\n\0\\\"","array":[null,true,false,{},[]]});
        legacy(
            &path,
            &serde_json::to_string(&("quoted\"field", "id\0中")).unwrap(),
            &value.to_string(),
        );
        let db = open(&path).unwrap();
        assert_eq!(
            load_map(&db, "old").unwrap()["quoted\"field"]["id\0中"],
            value
        );
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            VERSION
        );
        assert!(
            !db.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='kv')",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
        );
        assert_eq!(
            db.query_row("SELECT typeof(payload) FROM entries", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "blob"
        );
        drop(db);
        assert_eq!(
            load_map(&open(&path).unwrap(), "old").unwrap()["quoted\"field"]["id\0中"],
            value
        );
    }

    #[test]
    fn malformed_legacy_and_future_versions_do_not_discard_data() {
        for (key, payload) in [("invalid", "{}"), ("[\"field\",\"id\"]", "{")] {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("index.sqlite");
            legacy(&path, key, payload);
            assert!(open(&path).is_err());
            let db = Connection::open(&path).unwrap();
            assert_eq!(
                db.query_row("SELECT key,payload FROM kv", [], |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?
                )))
                .unwrap(),
                (key.into(), payload.into())
            );
            assert_eq!(
                db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert!(
                !db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='entries')",
                    [],
                    |r| r.get::<_, bool>(0)
                )
                .unwrap()
            );
            db.pragma_update(None, "user_version", 99).unwrap();
            drop(db);
            assert!(
                open(&path)
                    .unwrap_err()
                    .to_string()
                    .contains("unsupported live index")
            );
        }
    }

    #[test]
    fn replacements_isolate_fields_scopes_and_avoid_unchanged_writes() {
        let root = tempfile::tempdir().unwrap();
        let mut db = open(&root.path().join("index.sqlite")).unwrap();
        let initial =
            json!({"scalar":null,"empty":{},"list":[],"field":{"a":1,"b":2,"quoted\"id":3}});
        {
            let tx = db.transaction().unwrap();
            save_map(&tx, "one", initial.as_object().unwrap()).unwrap();
            save_map(&tx, "two", initial.as_object().unwrap()).unwrap();
            tx.commit().unwrap();
        }
        assert_eq!(Value::Object(load_map(&db, "one").unwrap()), initial);
        let changes = db.total_changes();
        save_map(&db, "one", initial.as_object().unwrap()).unwrap();
        assert_eq!(db.total_changes(), changes);
        save_fields(
            &db,
            "one",
            json!({"field":{"b":7}}).as_object().unwrap(),
            false,
        )
        .unwrap();
        assert_eq!(
            Value::Object(load_map(&db, "one").unwrap()),
            json!({"scalar":null,"empty":{},"list":[],"field":{"b":7}})
        );
        assert_eq!(Value::Object(load_map(&db, "two").unwrap()), initial);
        {
            let tx = db.transaction().unwrap();
            save_map(&tx, "one", json!({"new":1}).as_object().unwrap()).unwrap();
        }
        assert!(load_map(&db, "one").unwrap().contains_key("field"));
        save_map(&db, "one", json!({"new":1}).as_object().unwrap()).unwrap();
        assert_eq!(
            Value::Object(load_map(&db, "one").unwrap()),
            json!({"new":1})
        );
        remove(&db, "two", "field", "a").unwrap();
        assert_eq!(
            load_map(&db, "two").unwrap()["field"],
            json!({"b":2,"quoted\"id":3})
        );
        let count = db.total_changes();
        remove(&db, "absent", "field", "a").unwrap();
        assert_eq!(db.total_changes(), count);
    }

    #[test]
    fn field_replacement_prunes_old_ids_without_scanning_other_buckets() {
        let root = tempfile::tempdir().unwrap();
        let db = open(&root.path().join("index.sqlite")).unwrap();
        let first = [("a", 1), ("quoted\"id", 2), ("中", 3)];
        replace_field(&db, "s", "facts", first.iter().map(|(id, v)| (*id, v))).unwrap();
        let second = [("中", 7)];
        replace_field(&db, "s", "facts", second.iter().map(|(id, v)| (*id, v))).unwrap();
        assert_eq!(load_map(&db, "s").unwrap()["facts"], json!({"中":7}));
        replace_field::<i32>(&db, "s", "facts", std::iter::empty()).unwrap();
        assert_eq!(load_map(&db, "s").unwrap()["facts"], json!({}));
        let mut seen = 0;
        assert!(
            each(&db, "s", |_, _, _| {
                seen += 1;
                Ok(())
            })
            .unwrap()
        );
        assert_eq!(seen, 0);
        // The composite primary key supports bucket-local scans without sorting.
        let plan: String = db
            .query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM entries WHERE bucket=1",
                [],
                |r| r.get(3),
            )
            .unwrap();
        assert!(plan.contains("PRIMARY KEY"));
        db.execute("UPDATE entries SET payload=x'ff'", []).unwrap();
        assert!(load_map(&db, "s").is_err());
    }
}

#[cfg(test)]
mod fault_tests {
    use super::*;
    #[test]
    fn actual_sqlite_full_error_is_distinct_and_rolls_back_the_failed_write() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA max_page_count=2;CREATE TABLE sample(value BLOB);")
            .unwrap();
        let error = db
            .execute("INSERT INTO sample VALUES(zeroblob(1048576))", [])
            .unwrap_err();
        assert_eq!(failure_code(&error.into()), "STORAGE_FULL");
        assert_eq!(
            db.query_row("SELECT count(*) FROM sample", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
