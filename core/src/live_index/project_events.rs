//! Optional query indexes over the unchanged JSONB format. No event payload is copied.
use super::*;

pub(crate) struct EventReader {
    projection: i64,
    origins: Vec<i64>,
}

/// Prepare disposable indexes at writable index startup, including existing buckets.
/// Only supported observation headers qualify; existing indexes do not read event payloads.
pub(super) fn prepare_indexes(db: &Connection) -> Result<()> {
    let origins = db
        .prepare_cached("SELECT id,scope FROM buckets WHERE field='events'")?
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (origin, scope) in origins {
        use crate::observation_versions::ObservationHeaderSet;
        let (headers, header_scope) = if scope.starts_with("parser:") {
            let Some(scope) = scope.strip_suffix(":facts") else {
                continue;
            };
            (ObservationHeaderSet::Parser, scope)
        } else if scope.starts_with("projection:") {
            (ObservationHeaderSet::Projection, scope.as_str())
        } else {
            continue;
        };
        // Unsupported headers must be rejected by the owning operation before
        // any future-format event payload is examined by an expression index.
        if headers
            .validate_index(
                |field| scalar(db, header_scope, field),
                |_| "Unsupported event mapping",
            )
            .is_err()
        {
            continue;
        }
        prepare_bucket_index(db, origin)?;
    }
    Ok(())
}

pub(super) fn prepare_bucket_index(db: &Connection, origin: i64) -> Result<()> {
    // Bucket numbers come exclusively from SQLite integer keys, never source text.
    // Restrict each index to one event bucket; checkpoints and other facts are excluded.
    db.execute_batch(&format!(
        "CREATE INDEX IF NOT EXISTS event_threads_{origin} ON entries(json_extract(payload,'$.threadId'),id) WHERE bucket={origin} AND payload IS NOT NULL;"
    ))?;
    Ok(())
}

/// Discover membership under the caller's read snapshot without schema or fact writes.
pub(crate) fn prepare_event_reader(db: &Connection, scope: &str) -> Result<EventReader> {
    let projection: Option<i64> = db
        .prepare_cached("SELECT id FROM buckets WHERE scope=?1 AND field='events'")?
        .query_row([scope], |row| row.get(0))
        .optional()?;
    let Some(projection) = projection else {
        return Ok(EventReader {
            projection: -1,
            origins: vec![],
        });
    };
    let mut origins = db
        .prepare_cached("SELECT DISTINCT source_bucket FROM entries WHERE bucket=?1 AND source_bucket IS NOT NULL")?
        .query_map([projection], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    origins.push(projection);
    Ok(EventReader {
        projection,
        origins,
    })
}

impl EventReader {
    fn sql(&self, origin: i64, missing: bool) -> String {
        let target = if missing {
            "json_extract(t.payload,'$.threadId') IS NULL"
        } else {
            "json_extract(t.payload,'$.threadId') IN (SELECT value FROM json_each(?1))"
        };
        let payload = if origin == self.projection {
            "json(t.payload)"
        } else {
            "json_extract(t.payload,e.member)"
        };
        let membership = if origin == self.projection {
            String::new()
        } else {
            // Pin the small indexed thread selection before membership lookup. An ordinary
            // JOIN lets SQLite scan the entire projection again for every project.
            format!(
                " CROSS JOIN entries e ON e.bucket={} AND e.id=t.id AND e.source_bucket={origin}",
                self.projection
            )
        };
        format!(
            "SELECT t.id,{payload} FROM entries t INDEXED BY event_threads_{origin}{membership} WHERE t.bucket={origin} AND t.payload IS NOT NULL AND {target}"
        )
    }
    /// O(T log E + matching events), using exact recorded thread ownership.
    /// None includes only source facts with no thread, never a guessed project.
    pub(crate) fn each(
        &self,
        db: &Connection,
        threads: &[&str],
        unassigned: bool,
        mut consume: impl FnMut(&str, &str) -> Result<()>,
    ) -> Result<()> {
        let targets = serde_json::to_string(threads)?;
        for origin in &self.origins {
            for missing in [false, true] {
                if missing && !unassigned {
                    continue;
                }
                if !missing && threads.is_empty() {
                    continue;
                }
                let sql = self.sql(*origin, missing);
                let mut statement = db.prepare_cached(&sql)?;
                let mut rows = if missing {
                    statement.query([])?
                } else {
                    statement.query([&targets])?
                };
                while let Some(row) = rows.next()? {
                    let id = row.get_ref(0)?.as_str()?;
                    if id.is_empty() {
                        continue;
                    } // Empty-bucket sentinel.
                    consume(id, row.get_ref(1)?.as_str()?)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writable_startup_does_not_inspect_future_event_payloads() {
        for (scope, header_scope, headers) in [
            (
                "parser:synthetic:test:1:facts",
                "parser:synthetic:test:1",
                crate::observation_versions::ObservationHeaderSet::Parser,
            ),
            (
                "projection:synthetic",
                "projection:synthetic",
                crate::observation_versions::ObservationHeaderSet::Projection,
            ),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join("index.sqlite");
            let db = open(&path).unwrap();
            let mut metadata = Map::new();
            headers.write_json(&mut metadata);
            save_map(&db, header_scope, &metadata).unwrap();
            put(
                &db,
                scope,
                "events",
                "event",
                &serde_json::json!({"threadId":"t"}),
            )
            .unwrap();
            let origin = bucket(&db, scope, "events").unwrap();
            db.execute_batch(&format!("DROP INDEX event_threads_{origin}; UPDATE entries SET payload=x'6e6f742d6a736f6e' WHERE bucket={origin};")).unwrap();
            put(&db, header_scope, "eventObservationVersion", "", &99).unwrap();
            drop(db);
            // Index creation would evaluate malformed JSON before the header guard.
            let db = open(&path).unwrap();
            let error = headers
                .validate_index(
                    |field| scalar(&db, header_scope, field),
                    |_| "future observation",
                )
                .unwrap_err();
            assert_eq!(failure_code(&error), "UNSUPPORTED_VERSION");
            assert_eq!(
                db.query_row(
                    "SELECT hex(payload) FROM entries WHERE bucket=?1",
                    [origin],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
                "6E6F742D6A736F6E"
            );
            assert_eq!(db.total_changes(), 0);
        }
    }

    #[test]
    fn event_reads_work_on_read_only_connections_and_startup_repairs_optional_indexes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("index.sqlite");
        let db = open(&path).unwrap();
        let parser = "parser:synthetic:test:1";
        let facts = format!("{parser}:facts");
        let mut headers = Map::new();
        crate::observation_versions::ObservationHeaderSet::Parser.write_json(&mut headers);
        save_map(&db, parser, &headers).unwrap();
        put(
            &db,
            &facts,
            "events",
            "event",
            &serde_json::json!({"threadId":"selected"}),
        )
        .unwrap();
        reference(&db, "projection", "events", "event", &facts, Member::Whole).unwrap();
        let original = load_map(&db, "projection").unwrap();
        let origin = bucket(&db, &facts, "events").unwrap();
        db.execute_batch(&format!("DROP INDEX event_threads_{origin}"))
            .unwrap();
        drop(db);
        // Writable startup repairs only derived indexes in the current format.
        let db = open(&path).unwrap();
        assert_eq!(db.total_changes(), 0);
        assert_eq!(load_map(&db, "projection").unwrap(), original);
        drop(db);
        let db =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let reader = prepare_event_reader(&db, "projection").unwrap();
        let mut found = vec![];
        reader
            .each(&db, &["selected"], false, |id, _| {
                found.push(id.to_owned());
                Ok(())
            })
            .unwrap();
        assert_eq!(found, ["event"]);
        assert_eq!(db.total_changes(), 0);
    }

    #[test]
    fn project_seeks_precede_projection_membership_lookup() {
        let temp = tempfile::tempdir().unwrap();
        let db = open(&temp.path().join("index.sqlite")).unwrap();
        let origin = bucket(&db, "parser", "events").unwrap();
        let projection = bucket(&db, "projection", "events").unwrap();
        write(&db, origin, "event", r#"{"threadId":"selected"}"#).unwrap();
        db.execute(
            "INSERT INTO entries(bucket,id,source_bucket,member) VALUES(?1,'event',?2,'$')",
            params![projection, origin],
        )
        .unwrap();
        let reader = prepare_event_reader(&db, "projection").unwrap();
        let mut found = vec![];
        reader
            .each(&db, &["selected"], false, |id, _| {
                found.push(id.to_owned());
                Ok(())
            })
            .unwrap();
        assert_eq!(found, ["event"]);
        for missing in [false, true] {
            let mut statement = db
                .prepare(&format!(
                    "EXPLAIN QUERY PLAN {}",
                    reader.sql(origin, missing)
                ))
                .unwrap();
            let read = |row: &rusqlite::Row<'_>| row.get::<_, String>(3);
            let plan = if missing {
                statement
                    .query_map([], read)
                    .unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>()
            } else {
                statement
                    .query_map([r#"["selected"]"#], read)
                    .unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>()
            }
            .unwrap();
            let seek = plan
                .iter()
                .position(|step| step.contains("SEARCH t USING INDEX event_threads_"))
                .unwrap();
            let membership = plan
                .iter()
                .position(|step| {
                    step.contains("SEARCH e USING PRIMARY KEY") && step.contains("id=?")
                })
                .unwrap();
            assert!(
                seek < membership,
                "projection must not scan all event IDs before the project seek: {plan:?}"
            );
        }
    }
}
