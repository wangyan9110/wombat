use super::*;
use crate::session_events::{Event, MeasurementContextField as Field, Payload as SafePayload};

fn trusted() -> Value {
    json!({"type":"turn_context","timestamp":"2026-09-29T00:00:00Z","payload":{"turn_id":"u","model":"gpt-5.4","model_provider":"openai","api_provider":"openai","effort":"high"}})
}
fn observation(response: &str) -> Value {
    direct("t", "u", response, "2026-09-29T00:00:01Z", 100, 40, 10)
}
fn run(rows: &[Value]) -> Collected {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "sessions/a.jsonl", rows);
    collect(root.path())
}
fn measurement_events(collected: &Collected) -> Vec<&Event> {
    collected
        .events
        .iter()
        .filter(|e| matches!(e.payload(), SafePayload::Measurement { .. }))
        .map(AsRef::as_ref)
        .collect()
}

#[test]
fn explicit_conflicts_are_field_specific_and_never_inherit_old_values() {
    for (key, nested_key, field) in [
        ("model", "model", Field::Model),
        ("model_provider", "model_provider", Field::Provider),
        ("api_provider", "api_provider", Field::ApiProvider),
        ("effort", "reasoning_effort", Field::Effort),
    ] {
        let mut row = observation("r");
        row["payload"][key] = json!("CONTRADICT_A");
        row["payload"]["settings"] = json!({nested_key:"CONTRADICT_B"});
        let collected = run(&[meta("t"), trusted(), row]);
        let m = &collected.measurements[0];
        assert_eq!(m.tokens.total, Some(110));
        assert_eq!(
            m.model.raw.as_deref(),
            (field != Field::Model).then_some("gpt-5.4")
        );
        assert_eq!(
            m.model.provider.as_deref(),
            (field != Field::Provider).then_some("openai")
        );
        assert_eq!(
            m.model.api_provider.as_deref(),
            (field != Field::ApiProvider).then_some("openai")
        );
        assert_eq!(
            m.reasoning_effort.as_deref(),
            (field != Field::Effort).then_some("high")
        );
        assert_eq!(m.pricing_context_conflict, field != Field::Effort);
        assert!(
            collected.sources[0]
                .issues
                .iter()
                .any(|i| i.code == "contextConflict")
        );
        let event = measurement_events(&collected)[0];
        assert!(event.gaps().is_empty());
        assert!(
            matches!(event.payload(), SafePayload::Measurement { context_conflicts, .. } if context_conflicts == &[field])
        );
        let encoded = serde_json::to_string(event).unwrap();
        assert!(!encoded.contains("CONTRADICT_A") && !encoded.contains("CONTRADICT_B"));
    }
}

#[test]
fn missing_fields_inherit_but_foreign_owner_does_not() {
    let mut foreign = observation("foreign");
    foreign["payload"]["thread_id"] = json!("other");
    let collected = run(&[meta("t"), trusted(), observation("local"), foreign]);
    let local = collected
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("local"))
        .unwrap();
    assert_eq!(local.model.raw.as_deref(), Some("gpt-5.4"));
    assert_eq!(local.reasoning_effort.as_deref(), Some("high"));
    assert!(!local.pricing_context_conflict);
    let foreign = collected
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("foreign"))
        .unwrap();
    assert!(foreign.model.raw.is_none());
    assert!(!foreign.pricing_context_conflict);
}

#[test]
fn same_response_conflict_is_sticky_in_both_orders_and_replay() {
    let mut conflict = observation("r");
    conflict["payload"]["model_provider"] = json!("openai");
    conflict["payload"]["settings"] = json!({"model_provider":"other"});
    for rows in [
        [observation("r"), conflict.clone()],
        [conflict.clone(), observation("r")],
    ] {
        let collected = run(&[
            meta("t"),
            trusted(),
            rows[0].clone(),
            rows[1].clone(),
            observation("r"),
        ]);
        assert_eq!(collected.measurements.len(), 1);
        let m = &collected.measurements[0];
        assert!(m.model.provider.is_none());
        assert_eq!(m.model.raw.as_deref(), Some("gpt-5.4"));
        assert!(m.pricing_context_conflict);
        let (replayed, _) = super::event_projection::replay(&collected);
        assert_eq!(
            serde_json::to_value(&replayed.measurements).unwrap(),
            serde_json::to_value(&collected.measurements).unwrap()
        );
    }
}

#[test]
fn ordinary_cross_record_conflicts_set_price_guard_but_effort_does_not() {
    for key in ["model", "model_provider", "api_provider", "effort"] {
        let mut second = observation("r");
        second["payload"][key] = json!("changed");
        let collected = run(&[
            meta("t"),
            trusted(),
            observation("r"),
            second,
            observation("r"),
        ]);
        assert_eq!(collected.measurements.len(), 1);
        assert_eq!(
            collected.measurements[0].pricing_context_conflict,
            key != "effort"
        );
    }
}

#[test]
fn inherited_context_conflicts_survive_missing_settings_and_clear_only_for_new_evidence() {
    let mut settings = trusted();
    settings["type"] = json!("event_msg");
    settings["payload"]["type"] = json!("thread_settings_applied");
    settings["payload"]["settings"] = json!({"model_provider":"other"});
    let missing = json!({"type":"turn_context","timestamp":"2026-09-29T00:00:02Z","payload":{"turn_id":"u","model":"gpt-5.4"}});
    let collected = run(&[
        meta("t"),
        settings,
        observation("old"),
        missing,
        observation("missing"),
        trusted(),
        observation("new"),
        observation("old"),
    ]);
    for id in ["old", "missing"] {
        let m = collected
            .measurements
            .iter()
            .find(|m| m.response_id.as_deref() == Some(id))
            .unwrap();
        assert!(m.pricing_context_conflict);
        assert!(m.model.provider.is_none());
    }
    let new = collected
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("new"))
        .unwrap();
    assert!(!new.pricing_context_conflict);
    assert_eq!(new.model.provider.as_deref(), Some("openai"));
}

#[test]
fn thread_conflicts_follow_turn_boundaries_and_break_context_clears_them() {
    let mut settings = trusted();
    settings["type"] = json!("event_msg");
    settings["payload"]["type"] = json!("thread_settings_applied");
    settings["payload"]["settings"] = json!({"api_provider":"other"});
    let mut next = observation("next");
    next["payload"]["turn_id"] = json!("v");
    let collected = run(&[
        meta("t"),
        settings,
        trusted(),
        json!({"type":"event_msg","payload":{"type":"task_complete","turn_id":"u"}}),
        json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"v"}}),
        next,
        meta("t"),
        observation("reset"),
    ]);
    let next = collected
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("next"))
        .unwrap();
    assert!(next.pricing_context_conflict);
    assert!(next.model.api_provider.is_none());
    let reset = collected
        .measurements
        .iter()
        .find(|m| m.response_id.as_deref() == Some("reset"))
        .unwrap();
    assert!(!reset.pricing_context_conflict);
    assert!(reset.model.raw.is_none());
}

#[test]
fn safe_measurement_flags_and_canonical_price_marker_are_required_and_validated() {
    let collected = run(&[meta("t"), trusted(), observation("r")]);
    let encoded = serde_json::to_value(measurement_events(&collected)[0]).unwrap();
    assert!(serde_json::from_value::<Event>(encoded.clone()).is_ok());
    for flags in [
        json!(["model", "model"]),
        json!(["future"]),
        json!(["model", "provider", "apiProvider", "effort", "model"]),
        json!(["model"]),
    ] {
        let mut bad = encoded.clone();
        bad["payload"]["contextConflicts"] = flags;
        assert!(serde_json::from_value::<Event>(bad).is_err());
    }
    for (parent, key) in [
        ("payload", "contextConflicts"),
        ("value", "pricingContextConflict"),
    ] {
        let mut bad = encoded.clone();
        let object = if parent == "payload" {
            &mut bad["payload"]
        } else {
            &mut bad["payload"]["value"]
        };
        object.as_object_mut().unwrap().remove(key);
        assert!(serde_json::from_value::<Event>(bad).is_err());
    }
    let mut bad = encoded;
    bad["payload"]["value"]["pricingContextConflict"] = json!(true);
    assert!(serde_json::from_value::<Event>(bad).is_err());
}

#[test]
fn checkpoint_restart_preserves_thread_conflicts_and_safe_replay() {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let index = tempfile::tempdir().unwrap();
    let mut settings = trusted();
    settings["type"] = json!("event_msg");
    settings["payload"]["type"] = json!("thread_settings_applied");
    settings["payload"]["settings"] = json!({"model_provider":"other"});
    let path = write(
        root.path(),
        "sessions/a.jsonl",
        &[meta("t"), settings, observation("first")],
    );
    let source = CodexAdapter
        .discover(&DiscoveryRequest {
            roots: vec![root.path().into()],
        })
        .sources
        .remove(0);
    let sync = || {
        let mut db = crate::live_index::open(&index.path().join("index.sqlite")).unwrap();
        let tx = db.transaction().unwrap();
        let result = incremental::sync(&tx, &source, false).unwrap();
        tx.commit().unwrap();
        result
    };
    let initial = sync().unwrap();
    assert!(initial.measurements[0].pricing_context_conflict);
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all((observation("second").to_string() + "\n").as_bytes())
        .unwrap();
    let appended = sync().unwrap();
    assert_eq!(appended.measurements.len(), 2);
    assert!(
        appended
            .measurements
            .iter()
            .all(|m| m.pricing_context_conflict && m.model.provider.is_none())
    );
    assert!(initial.measurements[0].pricing_context_conflict);
    assert_eq!(
        serde_json::to_value(&appended.measurements).unwrap(),
        serde_json::to_value(&collect(root.path()).measurements).unwrap()
    );
    assert!(sync().is_none());
}
