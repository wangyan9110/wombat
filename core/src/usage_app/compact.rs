//! Bounded examples retain full quality counts and never change the ledger or page.
use super::*;
const EXAMPLES: usize = 3;

pub(super) fn apply(result: &mut Response) {
    result.facets = None;
    let quality = &mut result.quality;
    if quality.detail_summary.is_some() {
        return;
    }
    let mut issue_counts = BTreeMap::new();
    for issue in &quality.issues {
        *issue_counts.entry(issue.code.clone()).or_default() += 1;
    }
    let mut source_status_counts = BTreeMap::new();
    for source in &quality.sources {
        *source_status_counts
            .entry(source.status.clone())
            .or_default() += 1;
    }
    let source_issue_count: usize = quality.sources.iter().map(|s| s.issues.len()).sum();
    let mut summary = QualityDetailSummary {
        issue_count: quality.issues.len(),
        source_count: quality.sources.len(),
        issue_counts,
        source_status_counts,
        omitted_issues: quality.issues.len().saturating_sub(EXAMPLES),
        omitted_sources: quality.sources.len().saturating_sub(EXAMPLES),
        omitted_source_issues: 0,
    };
    quality.issues.truncate(EXAMPLES);
    quality.sources.truncate(EXAMPLES);
    for source in &mut quality.sources {
        source.issues.truncate(EXAMPLES);
    }
    let retained_source_issues: usize = quality.sources.iter().map(|s| s.issues.len()).sum();
    summary.omitted_source_issues = source_issue_count - retained_source_issues;
    quality.detail_summary = Some(summary);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_examples_preserve_totals_identity_and_full_quality_counts() {
        let mut snapshot = super::super::inspection::tests::snapshot(
            &[("a", "a", "2026-09-02T00:00:00Z", 100)],
            "compact",
        );
        snapshot.manifest.issues = (0..1000)
            .map(|n| Issue {
                code: if n % 2 == 0 { "missing" } else { "unreadable" }.into(),
                message: "Synthetic issue".repeat(100),
                source_instance_id: Some("synthetic".into()),
                evidence: None,
            })
            .collect();
        snapshot.manifest.sources[0].issues = snapshot.manifest.issues.clone();
        let mut request: Request = serde_json::from_value(serde_json::json!({
            "action":"usage", "scope":{"allTime":true}, "limit":1
        }))
        .unwrap();
        let full = execute_uncached(request.clone(), &snapshot).unwrap();
        request.compact = Some(true);
        let compact = execute_snapshot(request, &snapshot).unwrap();
        assert_eq!(compact.summary.tokens.total, Some(100));
        assert_eq!(
            serde_json::to_value(&compact.summary).unwrap(),
            serde_json::to_value(&full.summary).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&compact.items).unwrap(),
            serde_json::to_value(&full.items).unwrap()
        );
        assert_eq!(
            compact.snapshot_ref.snapshot_id,
            full.snapshot_ref.snapshot_id
        );
        assert_eq!(compact.quality.status, "partial");
        let counts = compact.quality.detail_summary.as_ref().unwrap();
        assert_eq!(counts.issue_count, 1000);
        assert_eq!(counts.issue_counts["missing"], 500);
        assert_eq!(counts.omitted_issues, 997);
        assert_eq!(counts.omitted_source_issues, 997);
        assert_eq!(compact.quality.issues.len(), 3);
        assert!(
            serde_json::to_vec(&compact).unwrap().len() * 10
                < serde_json::to_vec(&full).unwrap().len()
        );
        let mut twice = compact.clone();
        apply(&mut twice);
        assert_eq!(
            serde_json::to_value(twice).unwrap(),
            serde_json::to_value(compact).unwrap()
        );
    }
}
