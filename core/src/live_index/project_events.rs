//! Optional query indexes over the unchanged JSONB format. No event payload is copied.
use super::*;

pub(crate) struct EventReader {
    projection: i64,
    origins: Vec<i64>,
}

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
    // Bucket numbers come exclusively from SQLite integer keys, never source text.
    // Restrict each index to one event bucket; checkpoints and other facts are excluded.
    for origin in &origins {
        db.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS event_threads_{origin} ON entries(json_extract(payload,'$.threadId'),id) WHERE bucket={origin} AND payload IS NOT NULL;"
        ))?;
    }
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
