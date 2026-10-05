#[test]
fn required_observation_headers_reject_missing_and_future_versions() {
    use crate::observation_versions::ObservationKind::{Event, Title};
    let missing = serde_json::json!({});
    assert!(Event.validate_json(&missing, "unsupported").is_err());
    assert!(Title.validate_json(&missing, "unsupported").is_err());
    let old_event = serde_json::json!({"eventObservationVersion":1,"titleObservationVersion":1,"titleObservations":[]});
    assert!(Event.validate_json(&old_event, "unsupported").is_err());
    assert!(Title.validate_json(&old_event, "unsupported").is_ok());
    let future_title = serde_json::json!({"eventObservationVersion":Event.current(),"titleObservationVersion":2,"titleObservations":[]});
    assert!(Event.validate_json(&future_title, "unsupported").is_ok());
    assert!(Title.validate_json(&future_title, "unsupported").is_err());
    let valid = serde_json::json!({"eventObservationVersion":Event.current(),"titleObservationVersion":1,"titleObservations":[]});
    assert!(Event.validate_json(&valid, "unsupported").is_ok());
    assert!(Title.validate_json(&valid, "unsupported").is_ok());
}
