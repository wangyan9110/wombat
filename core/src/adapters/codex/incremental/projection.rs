//! Share only projection values exactly equal to the authoritative parser facts.
use super::*;
use crate::live_index::{Member, ReferenceField};
pub(crate) struct Projection<'a> {
    cache: &'a Cache,
    measurements: ReferenceField<'a>,
    events: ReferenceField<'a>,
    operations: ReferenceField<'a>,
}
impl<'a> Projection<'a> {
    pub(super) fn new(
        cache: &'a Cache,
        db: &'a Connection,
        source: &SourceInstance,
        scope: &str,
    ) -> Result<Self> {
        let origin = fact_scope(source);
        Ok(Self {
            cache,
            measurements: ReferenceField::new(
                db,
                scope,
                "measurements",
                &origin,
                Member::Measurement,
            )?,
            events: ReferenceField::new(db, scope, "events", &origin, Member::Whole)?,
            operations: ReferenceField::new(db, scope, "operations", &origin, Member::Whole)?,
        })
    }
    pub(crate) fn event(&self, row: &Arc<crate::session_events::Event>) -> Result<()> {
        self.events.reference(row.id())
    }
    pub(crate) fn measurement(&self, row: &Arc<Measurement>) -> Result<()> {
        if self
            .cache
            .facts
            .as_ref()
            .and_then(|f| f.measurements.get(&row.id))
            .is_some_and(|c| Arc::ptr_eq(&c.measurement, row) || c.measurement == *row)
        {
            self.measurements.reference(&row.id)
        } else {
            self.measurements.put(&row.id, row)
        }
    }
    pub(crate) fn operation(&self, row: &Arc<Operation>) -> Result<()> {
        if self
            .cache
            .facts
            .as_ref()
            .and_then(|f| f.operations.get(&row.id))
            .is_some_and(|original| Arc::ptr_eq(original, row) || original == row)
        {
            self.operations.reference(&row.id)
        } else {
            self.operations.put(&row.id, row)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn derived_values_keep_their_own_payload_and_equal_values_share() {
        let root = tempfile::tempdir().unwrap();
        let db = crate::live_index::open(&root.path().join("index.sqlite")).unwrap();
        let source = SourceInstance {
            id: "s".into(),
            agent_kind: "codex".into(),
            root: "/synthetic".into(),
        };
        let original: Arc<Measurement> = Arc::new(serde_json::from_value(serde_json::json!({"id":"m","agentKind":"codex","sourceInstanceId":"s","grain":"interval","timePrecision":"unknown","model":{},"tokens":{"total":100},"pricingContextConflict":false,"requestScoped":false,"sequence":1,"evidence":[]})).unwrap());
        let candidate = Candidate {
            measurement: original.clone(),
            direct: false,
            cumulative: Some(100),
            interval_start: Some(0),
            fingerprint: "synthetic".into(),
        };
        crate::live_index::put(&db, &fact_scope(&source), "measurements", "m", &candidate).unwrap();
        let cache = Cache {
            facts: Some(Facts {
                measurements: BTreeMap::from([("m".into(), candidate)]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let projection = cache.projection(&db, &source, "projection:s").unwrap();
        let mut changed = original.as_ref().clone();
        changed.tokens.total = Some(50);
        projection.measurement(&Arc::new(changed)).unwrap();
        assert_eq!(
            crate::live_index::load_map(&db, "projection:s").unwrap()["measurements"]["m"]["tokens"]
                ["total"],
            50
        );
        assert_eq!(
            crate::live_index::load_map(&db, &fact_scope(&source)).unwrap()["measurements"]["m"]["measurement"]
                ["tokens"]["total"],
            100
        );
        let equal = Arc::new(original.as_ref().clone());
        projection.measurement(&equal).unwrap();
        assert_eq!(
            crate::live_index::load_map(&db, "projection:s").unwrap()["measurements"]["m"]["tokens"]
                ["total"],
            100
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM entries WHERE source_bucket IS NOT NULL AND payload IS NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
}
