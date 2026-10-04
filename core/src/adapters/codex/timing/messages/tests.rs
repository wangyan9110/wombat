use super::*;
#[test]
fn presence_distinguishes_known_text_empty_and_unknown_complete_arrays() {
    for (body, native, expected) in [
        (
            r#"[{"type":"Text","text":"visible"}]"#,
            true,
            ContentPresence::NonEmpty,
        ),
        (
            r#"[{"type":"output_text","text":"\n\t "}]"#,
            false,
            ContentPresence::NonEmpty,
        ),
        (r#"[]"#, false, ContentPresence::Empty),
        (
            r#"[{"type":"future","text":"private"}]"#,
            false,
            ContentPresence::Unknown,
        ),
        (
            r#"[{"type":"future"},{"type":"output_text","text":"known"}]"#,
            false,
            ContentPresence::NonEmpty,
        ),
        (
            r#"[{"type":"future"},{"type":"output_text","text":""}]"#,
            false,
            ContentPresence::Unknown,
        ),
        (
            r#"[{"type":"Text","text":"native"}]"#,
            false,
            ContentPresence::Unknown,
        ),
        (
            r#"[{"type":"output_text","text":42}]"#,
            false,
            ContentPresence::Unknown,
        ),
        (r#"{}"#, false, ContentPresence::Unknown),
    ] {
        let raw = RawValue::from_string(body.into()).unwrap();
        assert_eq!(content_presence(Some(&raw), native), expected, "{body}");
    }
    assert_eq!(content_presence(None, false), ContentPresence::Unknown);
}
#[test]
fn history_only_explicit_inheritance_changes_origin() {
    for (body, expected) in [
        ("{}", None),
        (
            r#"{"inherited_user_message":true}"#,
            Some(MessageOrigin::Inherited),
        ),
        (
            r#"{"inherited_user_message":"unknown"}"#,
            Some(MessageOrigin::Unknown),
        ),
    ] {
        let raw = RawValue::from_string(body.into()).unwrap();
        assert_eq!(history_origin(Some(&raw)), expected);
    }
}

#[test]
fn literal_nonempty_presence_accepts_escaped_content_without_decoding_body_copies() {
    for (body, expected) in [
        (r#""""#, ContentPresence::Empty),
        (r#""\u0000""#, ContentPresence::NonEmpty),
        (r#""\uD83D\uDE00""#, ContentPresence::NonEmpty),
        (r#""\n\t ""#, ContentPresence::NonEmpty),
        ("null", ContentPresence::Unknown),
        ("42", ContentPresence::Unknown),
    ] {
        let raw = RawValue::from_string(body.into()).unwrap();
        assert_eq!(text_presence(Some(&raw)), expected);
    }
    let private = "PRIVATE_SYNTHETIC_LARGE".repeat(150_000);
    let encoded = serde_json::to_string(&private).unwrap();
    let raw = RawValue::from_string(encoded).unwrap();
    assert_eq!(text_presence(Some(&raw)), ContentPresence::NonEmpty);
}
