use super::*;
use crate::optimize_dto::Finding;

fn entry(key: &str, bytes: usize) -> Entry {
    let mut judgment = Assessment::Hit(vec![Finding {
        rule: "synthetic".into(),
        status: "failed".into(),
        observed: None,
        threshold: None,
        evidence_codes: vec![String::new()],
        basis: None,
        evidence: None,
    }]);
    let overhead = key.len() + serde_json::to_vec(&judgment).unwrap().len();
    if let Assessment::Hit(findings) = &mut judgment {
        findings[0].evidence_codes[0] = "x".repeat(bytes - overhead);
    }
    let entry = Entry::new(key.into(), &judgment).unwrap();
    assert_eq!(entry.bytes, bytes);
    entry
}
#[test]
fn lru_replacement_and_clones_preserve_entry_ownership() {
    let mut cache = JudgmentCache::default();
    for id in 0..MAX_ENTRIES {
        cache.insert(entry(&id.to_string(), 200));
    }
    let mut clone = cache.get("0").unwrap();
    if let Assessment::Hit(findings) = &mut clone {
        findings[0].rule = "modified".into();
    }
    cache.insert(entry("next", 200));
    assert!(cache.get("1").is_none());
    assert!(
        matches!(cache.get("0"), Some(Assessment::Hit(findings)) if findings[0].rule == "synthetic")
    );
    cache.insert(entry("0", 300));
    assert_eq!(cache.stats().0, MAX_ENTRIES);
    assert_eq!(cache.stats().1, MAX_ENTRIES * 200 + 100);
}
#[test]
fn encoded_byte_cap_evicts_even_below_entry_count_and_accepts_exact_boundary() {
    let mut cache = JudgmentCache::default();
    for id in 0..10 {
        cache.insert(entry(&id.to_string(), MAX_ENTRY_BYTES));
    }
    assert_eq!(cache.stats().0, MAX_BYTES / MAX_ENTRY_BYTES);
    assert_eq!(cache.stats().1, MAX_BYTES);
    assert!(cache.get("0").is_none());
    assert!(cache.get("9").is_some());
    let mut judgment = cache.get("9").unwrap();
    if let Assessment::Hit(findings) = &mut judgment {
        findings[0].evidence_codes[0].push('x');
    }
    assert!(Entry::new("9".into(), &judgment).is_none());
}
#[test]
fn bounded_encoding_counts_utf8_and_never_admits_unknown_judgments() {
    assert!(key(&"x".repeat(MAX_ENTRY_BYTES - 2), MAX_ENTRY_BYTES).is_some());
    assert!(key(&"x".repeat(MAX_ENTRY_BYTES - 1), MAX_ENTRY_BYTES).is_none());
    assert!(key(&"中".repeat(MAX_ENTRY_BYTES / 3), MAX_ENTRY_BYTES).is_none());
    assert!(key(&0, 0).is_none());
    assert!(Entry::new("key".into(), &Assessment::Insufficient("unknown")).is_none());
    assert!(Entry::new("key".into(), &Assessment::Unsupported("unsupported")).is_none());
    assert!(Entry::new("x".repeat(MAX_ENTRY_BYTES + 1), &Assessment::Miss).is_none());
    assert_eq!(key(&[1, 2, 3], 20), key(&[1, 2, 3], 20));
    assert_ne!(key(&[1, 2, 3], 20), key(&[1, 3, 2], 20));
}
