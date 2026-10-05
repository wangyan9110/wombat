use super::*;
#[test]
fn required_observation_headers_reject_missing_and_future_versions() {
    for raw in [
        serde_json::json!({}),
        serde_json::json!({"eventObservationVersion":1,"titleObservationVersion":1,"titleObservations":[]}),
        serde_json::json!({"eventObservationVersion":2,"titleObservationVersion":2,"titleObservations":[]}),
    ] {
        assert!(check_headers(&raw).is_err());
    }
    assert!(check_headers(&serde_json::json!({"eventObservationVersion":2,"titleObservationVersion":1,"titleObservations":[]})).is_ok());
}
