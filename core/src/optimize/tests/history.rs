use super::*;
use crate::optimize::{detection::detect, repository::connect, store};
#[test]
fn normalized_history_shares_evidence_and_only_decodes_the_requested_page() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reviews.sqlite3");
    let v = view();
    let mut s = detect(&v, &RuleParameters::default()).remove(0);
    crate::optimize::identity::capture(&mut s);
    s.decision = Some(UserDecision {
        binding: crate::optimize::identity::binding(&s),
        kind: DecisionKind::Keep,
        reason: DecisionReason::Necessary,
        recorded_at: "2026-10-01T00:00:00Z".into(),
    });
    let mut db = connect(&path).unwrap();
    let tx = db.transaction().unwrap();
    for _ in 0..100 {
        store::append(&tx, &mut s, RecordKind::Decision).unwrap();
    }
    assert_eq!(
        tx.query_row("SELECT COUNT(*) FROM review_parts", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        4
    );
    let read = store::get(&tx, 100).unwrap();
    assert_eq!(
        serde_json::to_value(&read).unwrap(),
        serde_json::to_value(&s).unwrap()
    );
    tx.execute("UPDATE review_events SET event=jsonb('{}') WHERE seq=1", [])
        .unwrap();
    tx.commit().unwrap();
    drop(db);
    let page = query(
        &path,
        &v,
        Request {
            group: Group::History,
            limit: Some(1),
            ..Default::default()
        },
    );
    assert_eq!(page.history, 100);
    assert_eq!(page.page.total, 100);
    assert_eq!(page.suggestions.len(), 1);
    assert_eq!(page.suggestions[0].record_id, s.record_id);
    assert!(
        execute_at(
            Request {
                group: Group::History,
                offset: Some(99),
                limit: Some(1),
                ..Default::default()
            },
            "test".into(),
            &v,
            &path
        )
        .is_err()
    );
}

#[test]
fn unsupported_review_schema_keeps_existing_records() {
    for version in [0, 1, 2, 3, 99] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reviews.sqlite3");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE sample(value TEXT);INSERT INTO sample VALUES('retained')")
            .unwrap();
        db.pragma_update(None, "user_version", version).unwrap();
        drop(db);
        assert!(connect(&path).is_err());
        let db = rusqlite::Connection::open(path).unwrap();
        assert_eq!(
            db.query_row("SELECT value FROM sample", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "retained"
        );
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name='review_events'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}

#[test]
fn review_store_preserves_native_only_and_calculated_usage_evidence() {
    use crate::adapters::contract::{TokenFields, TokenUsage};
    use crate::usage_app_dto::{
        AnalyzedTokenTotal, ObservedTokenSubtotal, TokenAnalysis, TokenAnalysisScope, UsageSummary,
    };
    for calculated in [false, true] {
        let tokens = TokenUsage {
            raw_input: Some(10),
            output: Some(2),
            total: (!calculated).then_some(12),
            ..Default::default()
        };
        let fields = TokenFields::from_fn(|field| {
            let value = tokens.get(field);
            ObservedTokenSubtotal {
                observed_subtotal: value,
                covered_records: u64::from(value.is_some()),
                missing_records: u64::from(value.is_none()),
                conflicting_records: 0,
                invalid_records: 0,
                indeterminate_records: 0,
            }
        });
        let price = crate::pricing::sum_prices(std::iter::empty()).unwrap();
        let summary = UsageSummary {
            input_total: Some(10),
            cache_hit_rate: None,
            unpriced_tokens: None,
            tokens,
            measurement_count: 1,
            price,
            token_analysis: TokenAnalysis {
                method_version: 1,
                scope: TokenAnalysisScope::SelectedCanonicalMeasurements,
                fields,
                total_analysis: calculated.then_some(AnalyzedTokenTotal {
                    method_version: 1,
                    subtotal: Some(12),
                    covered_records: 1,
                    recorded_records: 0,
                    calculated_records: 1,
                    unavailable_records: 0,
                    overflow_records: 0,
                }),
            },
        };
        let before = serde_json::to_value(&summary).unwrap();
        let mut v = view();
        v.items[0].usage = Some(summary);
        let mut suggestion = detect(&v, &RuleParameters::default()).remove(0);
        let dir = tempfile::tempdir().unwrap();
        let mut db = connect(&dir.path().join("reviews.sqlite3")).unwrap();
        let tx = db.transaction().unwrap();
        store::append(&tx, &mut suggestion, RecordKind::Observation).unwrap();
        let restored = store::get(&tx, 1).unwrap();
        assert_eq!(serde_json::to_value(&restored.item.usage).unwrap(), before);
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&suggestion).unwrap()
        );
    }
}
