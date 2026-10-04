use super::*;
fn position() -> Position {
    Position {
        source_instance_id: "source".into(),
        file_id: "file".into(),
        generation: "generation".into(),
        byte_offset: 20,
        ordinal: 0,
    }
}
fn event() -> Event {
    Event::new(
        position(),
        Some("thread".into()),
        Some("turn".into()),
        Time::from_source(Some("2026-10-04T10:00:00.123+08:00")).0,
        vec![],
        Payload::Activity {
            activity: ActivityKind::Assistant,
        },
    )
    .unwrap()
}
#[test]
fn record_identity_separates_files_generations_offsets_and_ordinals() {
    let p = position();
    let id = p.event_id().unwrap();
    for changed in [
        Position {
            file_id: "other".into(),
            ..p.clone()
        },
        Position {
            generation: "replacement".into(),
            ..p.clone()
        },
        Position {
            byte_offset: 21,
            ..p.clone()
        },
        Position {
            ordinal: 1,
            ..p.clone()
        },
        Position {
            source_instance_id: "other".into(),
            ..p.clone()
        },
    ] {
        assert_ne!(id, changed.event_id().unwrap());
    }
    assert_eq!(id, p.event_id().unwrap());
    let a = Position {
        source_instance_id: "a:b".into(),
        file_id: "c".into(),
        ..p.clone()
    };
    let b = Position {
        source_instance_id: "a".into(),
        file_id: "b:c".into(),
        ..p
    };
    assert_ne!(a.event_id().unwrap(), b.event_id().unwrap());
}
#[test]
fn unknown_time_is_not_zero_and_invalid_time_is_an_explicit_gap() {
    let (missing, gap) = Time::from_source(None);
    assert!(missing.timestamp.is_none());
    assert!(gap.is_none());
    let (invalid, gap) = Time::from_source(Some("not-a-date"));
    assert!(invalid.timestamp.is_none());
    assert_eq!(gap, Some(Gap::InvalidTimestamp));
    let (known, _) = Time::from_source(Some("2026-10-04T10:00:00.123+08:00"));
    assert_eq!(
        known.timestamp.as_deref(),
        Some("2026-10-04T02:00:00.123000000Z")
    );
    assert_eq!(known.precision, Precision::Millisecond);
}
#[test]
fn current_envelope_round_trips_but_unknown_versions_and_changed_identity_fail() {
    let original = event();
    let json = serde_json::to_value(&original).unwrap();
    let restored: Event = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(restored.id(), original.id());
    for (field, value) in [
        ("version", serde_json::json!(2)),
        ("id", serde_json::json!("forged")),
        ("raw", serde_json::json!("SYNTHETIC_PRIVATE_BODY")),
    ] {
        let mut changed = json.clone();
        changed[field] = value;
        assert!(serde_json::from_value::<Event>(changed).is_err());
    }
}
#[test]
fn payload_rejects_bodies_and_unknown_kinds() {
    let mut json = serde_json::to_value(event()).unwrap();
    json["payload"]["body"] = serde_json::json!("SYNTHETIC_PRIVATE_BODY");
    assert!(serde_json::from_value::<Event>(json).is_err());
    assert!(serde_json::from_str::<Payload>(r#"{"kind":"raw","text":"secret"}"#).is_err());
}
#[test]
fn source_constructor_rejects_unscoped_turn_and_false_precision() {
    assert!(
        Event::new(
            position(),
            None,
            Some("turn".into()),
            Time::from_source(None).0,
            vec![],
            Payload::Activity {
                activity: ActivityKind::Tool
            }
        )
        .is_err()
    );
    assert!(
        Event::new(
            position(),
            None,
            None,
            Time {
                timestamp: None,
                precision: Precision::Second
            },
            vec![],
            Payload::Activity {
                activity: ActivityKind::Tool
            }
        )
        .is_err()
    );
}

#[test]
fn payload_scope_cannot_be_rebound_to_another_turn() {
    let fact = Turn {
        id: "turn".into(),
        thread_id: "thread".into(),
        upstream_id: "native-turn".into(),
        ordinal: 1,
        started_at: None,
        ended_at: None,
        last_activity_at: None,
        status: "running".into(),
    };
    let original = Event::new(
        position(),
        Some("thread".into()),
        Some("turn".into()),
        Time::from_source(None).0,
        vec![],
        Payload::Turn {
            value: fact,
            evidence: EvidenceRef {
                file: "synthetic".into(),
                line: 1,
            },
        },
    )
    .unwrap();
    let mut json = serde_json::to_value(original).unwrap();
    json["turnId"] = serde_json::json!("different");
    assert!(serde_json::from_value::<Event>(json).is_err());
}
#[test]
fn native_zero_duration_is_preserved_without_inventing_a_timestamp() {
    let event = Event::new(
        position(),
        Some("thread".into()),
        Some("turn".into()),
        Time::from_source(None).0,
        vec![],
        Payload::Lifecycle {
            lifecycle: LifecycleKind::ModelRequest,
            phase: Phase::Completed,
            native_id: Some("response".into()),
            duration_ms: Some(0),
            first_token_ms: None,
        },
    )
    .unwrap();
    let restored: Event = serde_json::from_slice(&serde_json::to_vec(&event).unwrap()).unwrap();
    assert!(restored.time().timestamp.is_none());
    assert!(matches!(
        restored.payload(),
        Payload::Lifecycle {
            duration_ms: Some(0),
            first_token_ms: None,
            ..
        }
    ));
}

#[test]
fn restored_item_retains_submillisecond_duration_and_rejects_unsafe_native_numbers() {
    let mut json = serde_json::to_value(event()).unwrap();
    json["payload"] = serde_json::json!({"kind":"item","item_kind":"command","native_id":"c","phase":"completed","started_at_ms":0,"completed_at_ms":1,"duration":{"secs":0,"nanos":1}});
    let restored: Event = serde_json::from_value(json.clone()).unwrap();
    assert!(
        matches!(restored.payload(), Payload::Item { duration: Some(d), .. } if d.secs == 0 && d.nanos == 1)
    );
    for (pointer, value) in [
        ("/payload/duration/nanos", 1_000_000_000u64),
        ("/payload/duration/secs", u64::MAX),
        ("/payload/completed_at_ms", MAX_SAFE_INTEGER + 1),
    ] {
        let mut malformed = json.clone();
        *malformed.pointer_mut(pointer).unwrap() = serde_json::json!(value);
        assert!(serde_json::from_value::<Event>(malformed).is_err());
    }
}

#[test]
fn safe_message_roundtrips_closed_enums_and_rejects_body_or_empty_identity() {
    let message = Event::new(
        position(),
        Some("thread".into()),
        Some("turn".into()),
        Time::from_source(None).0,
        vec![],
        Payload::Message {
            origin: MessageOrigin::AssistantVisible,
            presence: ContentPresence::Unknown,
            native_id: Some("item".into()),
            record_kind: MessageRecordKind::NativeSnapshot,
            record_phase: Phase::Completed,
            content_phase: ContentPhase::Unknown,
        },
    )
    .unwrap();
    let stored = serde_json::to_value(&message).unwrap();
    assert!(serde_json::from_value::<Event>(stored.clone()).is_ok());
    for (field, value) in [
        ("body", serde_json::json!("PRIVATE")),
        ("presence", serde_json::json!("future")),
        ("native_id", serde_json::json!("")),
    ] {
        let mut changed = stored.clone();
        changed["payload"][field] = value;
        assert!(serde_json::from_value::<Event>(changed).is_err());
    }
}
