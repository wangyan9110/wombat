use super::*;
fn observed(arguments: &str) -> OperationMatchObservation {
    let body = format!(r#"{{"server":"synthetic","tool":"search","arguments":{arguments}}}"#);
    invocation(&body, Some("thread"))
}
fn invocation(body: &str, receiver: Option<&str>) -> OperationMatchObservation {
    let raw = RawValue::from_string(body.to_owned()).unwrap();
    let payload: Payload<'_> = serde_json::from_str(raw.get()).unwrap();
    observe(&payload, Some(&raw), receiver, true)
}
#[test]
fn complete_parameters_normalize_object_order_and_escaping_only() {
    let first = observed(r#"{"nested":{"z":3,"a":"\u0061"},"list":[1,2]}"#);
    assert!(first.request_fingerprint.is_some());
    assert_eq!(
        first.request_fingerprint,
        observed(r#"{ "list":[1,2], "nested":{"a":"a","z":3} }"#).request_fingerprint
    );
    for different in [
        r#"{"nested":{"z":3,"a":"a"},"list":[2,1]}"#,
        r#"{"nested":{"z":3,"a":"a"},"list":[1,2],"extra":null}"#,
    ] {
        assert_ne!(
            first.request_fingerprint,
            observed(different).request_fingerprint
        );
    }
    assert_eq!(
        observed(r#""{\"x\":1}""#).request_fingerprint,
        observed(r#"{"x":1}"#).request_fingerprint
    );
}
#[test]
fn exact_numbers_never_collapse_to_floating_point_matches() {
    for (left, right) in [
        ("9007199254740992", "9007199254740993"),
        ("0.123456789012345678901", "0.123456789012345678902"),
        ("1", "1.0"),
    ] {
        let a = observed(&format!("{{\"value\":{left}}}"));
        let b = observed(&format!("{{\"value\":{right}}}"));
        assert!(a.request_fingerprint.is_some());
        assert_ne!(
            a.request_fingerprint, b.request_fingerprint,
            "{left} and {right}"
        );
    }
}
#[test]
fn duplicates_unknown_context_and_non_objects_cannot_match() {
    for arguments in [
        r#"{"x":1,"x":2}"#,
        r#"{"x":{"$serde_json::private::Number":"1"}}"#,
        r#"{"a":{"x":1,"\u0078":2}}"#,
        r#"[{"x":1}]"#,
        "12",
        r#""not JSON""#,
    ] {
        let result = observed(arguments);
        assert!(result.request_fingerprint.is_none());
        assert!(result.gaps.contains(&MatchGap::UnsupportedParameters));
    }
    let missing = invocation(r#"{"server":"synthetic","tool":"search"}"#, Some("thread"));
    assert!(missing.gaps.contains(&MatchGap::MissingParameters));
    let extra = invocation(
        r#"{"server":"synthetic","tool":"search","arguments":{},"context":"PRIVATE"}"#,
        Some("thread"),
    );
    assert!(extra.gaps.contains(&MatchGap::UnsupportedParameters));
    let raw = RawValue::from_string(
        r#"{"server":"synthetic","tool":"search","arguments":{},"arguments":{"x":1}}"#.into(),
    )
    .unwrap();
    let valid = r#"{"server":"synthetic","tool":"search","arguments":{}}"#;
    let payload: Payload<'_> = serde_json::from_str(valid).unwrap();
    let duplicate = observe(&payload, Some(&raw), Some("thread"), true);
    assert!(duplicate.request_fingerprint.is_none());
}
#[test]
fn bounds_discard_whole_fingerprint_and_preserve_receiver_gap() {
    let oversized = observed(&format!("{{\"x\":\"{}\"}}", "x".repeat(MATCH_STRING_BYTES)));
    let nodes = observed(&format!("{{\"x\":[{}]}}", vec!["0"; NODE_LIMIT].join(",")));
    let depth = observed(&format!(
        "{{\"x\":{}0{}}}",
        "[".repeat(DEPTH_LIMIT + 1),
        "]".repeat(DEPTH_LIMIT + 1)
    ));
    for result in [oversized, nodes, depth] {
        assert!(result.request_fingerprint.is_none());
        assert!(result.gaps.contains(&MatchGap::ResourceLimit));
    }
    let foreign = invocation(
        r#"{"server":"synthetic","tool":"search","arguments":{"private":"PRIVATE_BODY"}}"#,
        None,
    );
    assert!(foreign.request_fingerprint.is_some());
    assert!(foreign.gaps.contains(&MatchGap::MissingReceiver));
    assert!(foreign.read_targets.is_empty());
    assert!(!foreign.expected_nonzero);
    assert!(!serde_json::to_string(&foreign).unwrap().contains("PRIVATE"));
}
#[test]
fn service_identity_participates_and_missing_fields_fill_without_healing_conflict() {
    let original = observed("{}");
    let changed = invocation(
        r#"{"server":"other","tool":"search","arguments":{}}"#,
        Some("thread"),
    );
    assert_ne!(original.request_fingerprint, changed.request_fingerprint);
    let mut merged = Some(invocation(
        r#"{"server":"synthetic","tool":"search"}"#,
        Some("thread"),
    ));
    super::super::merge(&mut merged, &Some(original.clone()));
    assert_eq!(
        merged.as_ref().unwrap().request_fingerprint,
        original.request_fingerprint
    );
    assert!(
        !merged
            .as_ref()
            .unwrap()
            .gaps
            .contains(&MatchGap::MissingParameters)
    );
    super::super::merge(&mut merged, &Some(changed));
    super::super::merge(&mut merged, &Some(original));
    let result = merged.unwrap();
    assert!(result.request_fingerprint.is_none());
    assert!(result.receiver_owner.is_none());
    assert!(result.gaps.contains(&MatchGap::ConflictingObservation));
}

#[test]
fn exact_parameter_limits_are_usable_and_the_next_unit_is_omitted() {
    let base = serde_json::to_vec(&(
        "native_mcp_request_v1",
        Some("synthetic"),
        Some("search"),
        serde_json::json!({"x":""}),
    ))
    .unwrap()
    .len();
    let exact = observed(&format!(
        "{{\"x\":\"{}\"}}",
        "x".repeat(MATCH_STRING_BYTES - base)
    ));
    assert!(exact.request_fingerprint.is_some());
    let larger = observed(&format!(
        "{{\"x\":\"{}\"}}",
        "x".repeat(MATCH_STRING_BYTES - base + 1)
    ));
    assert!(larger.gaps.contains(&MatchGap::ResourceLimit));
    let nodes = observed(&format!(
        "{{\"x\":[{}]}}",
        vec!["0"; NODE_LIMIT - 2].join(",")
    ));
    assert!(nodes.request_fingerprint.is_some());
    let deep = observed(&format!(
        "{{\"x\":{}0{}}}",
        "[".repeat(DEPTH_LIMIT - 1),
        "]".repeat(DEPTH_LIMIT - 1)
    ));
    assert!(deep.request_fingerprint.is_some());
}
