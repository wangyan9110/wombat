use super::*;

#[test]
fn descriptors_define_the_six_current_flat_fields() {
    let expected = [
        (
            ObservationKind::Event,
            "eventObservationVersion",
            crate::session_events::EVENT_VERSION,
        ),
        (
            ObservationKind::Title,
            "titleObservationVersion",
            crate::session_events::title_observations::TITLE_OBSERVATION_VERSION,
        ),
        (
            ObservationKind::Work,
            "workObservationVersion",
            crate::adapters::contract::WORK_OBSERVATION_VERSION,
        ),
        (
            ObservationKind::Message,
            "messageObservationVersion",
            crate::adapters::codex::incremental::MESSAGE_OBSERVATION_VERSION,
        ),
        (
            ObservationKind::Measurement,
            "measurementObservationVersion",
            crate::adapters::codex::incremental::MEASUREMENT_OBSERVATION_VERSION,
        ),
        (
            ObservationKind::Operation,
            "operationObservationVersion",
            crate::adapters::codex::incremental::OPERATION_OBSERVATION_VERSION,
        ),
    ];
    for (kind, field, version) in expected {
        assert_eq!(kind.field(), field);
        assert_eq!(kind.current(), version);
    }
}

#[test]
fn parser_projection_and_snapshot_sets_write_and_validate_the_same_headers() {
    for set in [
        ObservationHeaderSet::Parser,
        ObservationHeaderSet::Projection,
        ObservationHeaderSet::Snapshot,
    ] {
        let mut object = Map::new();
        set.write_json(&mut object);
        let raw = Value::Object(object);
        assert!(set.validate_json(&raw, |_| "unsupported").is_ok());
        for &kind in set.kinds() {
            assert_eq!(raw[kind.field()], Value::from(kind.current()));
        }

        for &kind in set.kinds() {
            let mut missing = raw.clone();
            missing.as_object_mut().unwrap().remove(kind.field());
            assert_eq!(
                crate::live_index::failure_code(
                    &set.validate_json(&missing, |_| "unsupported").unwrap_err()
                ),
                "UNSUPPORTED_VERSION"
            );
            for invalid in [
                Value::from(kind.current().saturating_sub(1)),
                Value::from(kind.current().saturating_add(1)),
                Value::from(-1),
                serde_json::json!(1.5),
                Value::Null,
                Value::from("not an integer"),
            ] {
                let mut changed = raw.clone();
                changed[kind.field()] = invalid;
                assert_eq!(
                    crate::live_index::failure_code(
                        &set.validate_json(&changed, |_| "unsupported").unwrap_err()
                    ),
                    "UNSUPPORTED_VERSION"
                );
            }
        }
    }
    assert_eq!(
        ObservationHeaderSet::Parser.kinds(),
        ObservationHeaderSet::Projection.kinds()
    );
}

#[test]
fn index_validation_rejects_missing_and_future_headers() {
    let set = ObservationHeaderSet::Projection;
    let mut object = Map::new();
    set.write_json(&mut object);
    let valid = Value::Object(object);
    assert!(
        set.validate_index(
            |field| Ok(valid.get(field).cloned()),
            |_| "projection mapping unsupported"
        )
        .is_ok()
    );

    for &kind in set.kinds() {
        let mut changed = valid.clone();
        changed.as_object_mut().unwrap().remove(kind.field());
        assert_eq!(
            crate::live_index::failure_code(
                &set.validate_index(
                    |field| Ok(changed.get(field).cloned()),
                    |_| "projection mapping unsupported"
                )
                .unwrap_err()
            ),
            "UNSUPPORTED_VERSION"
        );
        for invalid in [
            Value::from(kind.current().saturating_sub(1)),
            Value::from(kind.current().saturating_add(1)),
            Value::from(-1),
            serde_json::json!(1.5),
            Value::Null,
            Value::from("not an integer"),
        ] {
            let mut changed = valid.clone();
            changed[kind.field()] = invalid;
            assert_eq!(
                crate::live_index::failure_code(
                    &set.validate_index(
                        |field| Ok(changed.get(field).cloned()),
                        |_| "projection mapping unsupported"
                    )
                    .unwrap_err()
                ),
                "UNSUPPORTED_VERSION"
            );
        }
    }
}

#[test]
fn snapshot_version_group_serializes_as_the_existing_flat_manifest_headers() {
    let versions = SnapshotObservationVersions::current();
    let value = serde_json::to_value(versions).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "eventObservationVersion": ObservationKind::Event.current(),
            "messageObservationVersion": ObservationKind::Message.current(),
            "measurementObservationVersion": ObservationKind::Measurement.current(),
            "operationObservationVersion": ObservationKind::Operation.current(),
            "titleObservationVersion": ObservationKind::Title.current(),
        })
    );
    assert_eq!(
        serde_json::from_value::<SnapshotObservationVersions>(value).unwrap(),
        versions
    );
}
