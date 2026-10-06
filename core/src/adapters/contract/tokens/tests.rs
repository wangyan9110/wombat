//! Independent field evidence and merge truth.
use super::*;

#[test]
fn zero_and_explicit_unknown_are_valid_but_unexplained_or_contradictory_fields_fail() {
    let tokens = TokenUsage {
        total: Some(0),
        ..Default::default()
    };
    let mut reasons = tokens.unavailable_reasons(TokenUnavailableReason::Missing);
    assert!(validate_token_observations(&tokens, &reasons).is_ok());
    reasons.total = Some(TokenUnavailableReason::Invalid);
    assert!(validate_token_observations(&tokens, &reasons).is_err());
    reasons.total = None;
    reasons.raw_input = None;
    assert!(validate_token_observations(&tokens, &reasons).is_err());
    assert!(
        serde_json::from_value::<TokenFields<Option<TokenUnavailableReason>>>(
            serde_json::json!({"total":"future"})
        )
        .is_err()
    );
}

#[test]
fn evidence_repairs_absence_and_invalid_fields_but_never_an_explicit_count_conflict() {
    let first = TokenUsage {
        total: Some(10),
        ..Default::default()
    };
    let first_reasons = first.unavailable_reasons(TokenUnavailableReason::Missing);
    let mut current = TokenUsage::default();
    let mut reasons = current.unavailable_reasons(TokenUnavailableReason::Invalid);
    assert!(!merge_token_observations(
        &mut current,
        &mut reasons,
        &first,
        &first_reasons
    ));
    assert_eq!(current.total, Some(10));
    assert_eq!(reasons.total, None);
    let second = TokenUsage {
        total: Some(11),
        ..Default::default()
    };
    let second_reasons = second.unavailable_reasons(TokenUnavailableReason::Missing);
    assert!(merge_token_observations(
        &mut current,
        &mut reasons,
        &second,
        &second_reasons
    ));
    assert_eq!(current.total, None);
    assert_eq!(reasons.total, Some(TokenUnavailableReason::Conflicting));
    assert!(!merge_token_observations(
        &mut current,
        &mut reasons,
        &first,
        &first_reasons
    ));
    assert_eq!(current.total, None);
    assert!(validate_token_observations(&current, &reasons).is_ok());
}
