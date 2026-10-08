//! Exact native identities bind to current committed log facts, never nearby content/time.
use super::*;
use crate::adapters::contract::{Thread, Turn};

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AssociationState {
    Unknown,
    Linked,
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    pub state: AssociationState,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub source_epoch: Option<String>,
}
fn unknown(state: AssociationState) -> Association {
    Association {
        state,
        thread_id: None,
        turn_id: None,
        source_epoch: None,
    }
}
pub(super) fn associate(rows: &mut [EventRow], file: &Path) {
    if rows.is_empty() {
        return;
    }
    let result = (|| -> Result<()> {
        if !file.exists() {
            return Ok(());
        }
        let mut db = crate::live_index::reader(file)?;
        let tx = db.transaction()?;
        for row in rows.iter_mut() {
            let o = &row.observation;
            let projection = format!("projection:{}", o.source_instance_id);
            let thread_id =
                crate::adapters::codex::thread_identity(&o.source_instance_id, &o.session_id);
            let Some(thread) =
                crate::live_index::fact::<Thread>(&tx, &projection, "threads", &thread_id)?
            else {
                continue;
            };
            if thread.source_instance_id != o.source_instance_id
                || thread.upstream_id != o.session_id
                || thread.id != thread_id
                || o.project.is_some() && thread.project != o.project
            {
                continue;
            }
            let epoch =
                crate::live_index::scalar(&tx, &format!("epoch:{}", o.source_instance_id), "id")?
                    .and_then(|v| v.as_str().map(str::to_owned));
            let Some(epoch) = epoch else {
                continue;
            };
            let turn_id = if let Some(native) = &o.turn_id {
                let id = crate::adapters::codex::turn_identity(&thread_id, native);
                crate::live_index::fact::<Turn>(&tx, &projection, "turns", &id)?
                    .filter(|t| t.id == id && t.upstream_id == *native && t.thread_id == thread_id)
                    .map(|t| t.id)
            } else {
                None
            };
            row.association = Association {
                state: AssociationState::Linked,
                thread_id: Some(thread_id),
                turn_id,
                source_epoch: Some(epoch),
            };
        }
        tx.commit()?;
        Ok(())
    })();
    if result.is_err() {
        for row in rows {
            row.association = unknown(AssociationState::Unavailable);
        }
    }
}
pub(super) fn initial() -> Association {
    unknown(AssociationState::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> EventRow {
        EventRow {
            sequence: 1,
            received_at: "2026-10-08T00:00:00Z".into(),
            buffered: false,
            observation: Observation {
                id: "receipt".into(),
                source_instance_id: "source".into(),
                session_id: "session".into(),
                turn_id: Some("turn".into()),
                tool_use_id: None,
                agent_id: None,
                project: Some("/synthetic/project".into()),
                kind: EventKind::PostToolUse,
                occurred_at: None,
                native_identity: true,
            },
            association: initial(),
        }
    }
    #[test]
    fn missing_and_unknown_index_keep_receipts_without_false_links_or_writes() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("index.sqlite");
        let mut rows = [row()];
        associate(&mut rows, &file);
        assert!(matches!(
            rows[0].association.state,
            AssociationState::Unknown
        ));
        assert!(!file.exists());
        let db = Connection::open(&file).unwrap();
        db.pragma_update(None, "user_version", 99).unwrap();
        drop(db);
        associate(&mut rows, &file);
        assert!(matches!(
            rows[0].association.state,
            AssociationState::Unavailable
        ));
        assert!(rows[0].association.thread_id.is_none());
        let db = Connection::open(&file).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            99
        );
    }
    #[test]
    fn association_requires_exact_source_session_project_epoch_and_turn_membership() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("index.sqlite");
        let db = crate::live_index::open(&file).unwrap();
        let thread = crate::adapters::codex::thread_identity("source", "session");
        let turn = crate::adapters::codex::turn_identity(&thread, "turn");
        let facts = serde_json::json!({"threads":{thread.clone():{"id":thread,"sourceInstanceId":"source","upstreamId":"session","agentKind":"codex","project":"/synthetic/project","title":null,"startedAt":null,"lastActivityAt":null}},"turns":{turn.clone():{"id":turn,"threadId":thread,"upstreamId":"turn","ordinal":0,"startedAt":null,"endedAt":null,"lastActivityAt":null,"status":"unknown"}}});
        crate::live_index::save_map(&db, "projection:source", facts.as_object().unwrap()).unwrap();
        let mut rows = [row()];
        associate(&mut rows, &file);
        assert!(matches!(
            rows[0].association.state,
            AssociationState::Unknown
        ));
        crate::live_index::save_map(
            &db,
            "epoch:source",
            serde_json::json!({"id":"epoch-one"}).as_object().unwrap(),
        )
        .unwrap();
        associate(&mut rows, &file);
        assert_eq!(rows[0].association.turn_id.as_deref(), Some(turn.as_str()));
        assert_eq!(
            rows[0].association.source_epoch.as_deref(),
            Some("epoch-one")
        );
        for field in ["project", "session", "source"] {
            let mut candidate = row();
            match field {
                "project" => candidate.observation.project = Some("/synthetic/other".into()),
                "session" => candidate.observation.session_id = "other".into(),
                _ => candidate.observation.source_instance_id = "other".into(),
            }
            associate(std::slice::from_mut(&mut candidate), &file);
            assert!(matches!(
                candidate.association.state,
                AssociationState::Unknown
            ));
        }
        let mut candidate = row();
        candidate.observation.turn_id = Some("missing".into());
        associate(std::slice::from_mut(&mut candidate), &file);
        assert_eq!(
            candidate.association.thread_id.as_deref(),
            Some(thread.as_str())
        );
        assert!(candidate.association.turn_id.is_none());
    }
}
