use super::*;
fn interval(item: &str, category: Category, start: i64, end: i64) -> LifecycleInterval {
    LifecycleInterval {
        identity: Identity {
            source: "source".into(),
            task: "task".into(),
            turn: "turn".into(),
            item: item.into(),
        },
        category,
        start_ms: Some(start),
        end_ms: Some(end),
    }
}
fn window(start_ms: i64, end_ms: i64) -> Window {
    Window { start_ms, end_ms }
}
#[test]
fn independent_proposal_truth() {
    let input = [
        interval("c", Category::Compaction, 0, 30),
        interval("a", Category::Command, 30, 60),
        interval("b", Category::Command, 50, 80),
        interval("r", Category::Reasoning, 20, 50),
    ];
    let result = analyze(Some(window(0, 100)), &input, &[window(0, 40)], 5);
    assert_eq!(result.category_union_ms, [50, 30, 30]);
    assert_eq!(result.category_sum_ms, [60, 30, 30]);
    assert_eq!(result.mask_ms, [20, 30, 20, 0, 0, 20, 10, 0]);
    assert_eq!(result.covered_ms, Some(80));
    assert_eq!(result.coverage_ratio, Some(0.8));
    assert_eq!(result.gap_union_ms, 40);
    assert_eq!(result.gap_intersection_mask_ms, [0, 0, 20, 0, 0, 10, 10, 0]);
    let only_gap = analyze(Some(window(0, 100)), &[], &[window(0, 40)], 1);
    assert_eq!(only_gap.unclassified_ms, Some(100));
    assert_eq!(only_gap.covered_ms, Some(0));
}
#[test]
fn unordered_adjacent_duplicates_and_zero() {
    let a = interval("a", Category::Command, 0, 10);
    let input = [
        interval("b", Category::Command, 10, 20),
        interval("zero", Category::Reasoning, 10, 10),
        a.clone(),
        a,
    ];
    let result = analyze(Some(window(0, 20)), &input, &[], 4);
    assert_eq!(result.category_sum_ms, [20, 0, 0]);
    assert_eq!(result.category_union_ms, [20, 0, 0]);
    assert_eq!(result.complete_intervals, [2, 0, 1]);
}
#[test]
fn conflicts_open_reversed_and_clipped_are_visible() {
    let a = interval("a", Category::Command, 0, 10);
    let mut conflict = a.clone();
    conflict.end_ms = Some(11);
    let mut open = interval("open", Category::Command, 0, 20);
    open.end_ms = None;
    let result = analyze(
        Some(window(0, 20)),
        &[
            a,
            conflict,
            open,
            interval("reverse", Category::Reasoning, 9, 8),
            interval("clip", Category::Compaction, -5, 30),
        ],
        &[window(10, 9)],
        6,
    );
    assert_eq!(result.category_union_ms, [0, 20, 0]);
    assert_eq!(result.issues.len(), 5);
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::Conflict(_)))
    );
}
#[test]
fn unavailable_zero_reversed_windows_and_limits() {
    assert_eq!(analyze(None, &[], &[], 0).unclassified_ms, None);
    assert_eq!(
        analyze(Some(window(0, 0)), &[], &[], 0).coverage_ratio,
        None
    );
    assert_eq!(
        analyze(Some(window(1, 0)), &[], &[], 0).issues,
        [Issue::InvalidWindow]
    );
    let input = [interval("a", Category::Command, 0, 10)];
    let result = analyze(Some(window(0, 10)), &input, &[], 0);
    assert!(result.partial);
    assert_eq!(result.covered_ms, None);
    assert_eq!(result.issues, [Issue::ResourceLimit]);
    assert!(!analyze(Some(window(0, 10)), &input, &[], 1).partial);
}

#[test]
fn unavailable_window_retains_input_coverage_quality() {
    let command = interval("command", Category::Command, 0, 10);
    let mut conflict = command.clone();
    conflict.end_ms = Some(11);
    let mut open = interval("open", Category::Compaction, 0, 20);
    open.end_ms = None;
    let input = [
        command.clone(),
        command,
        conflict,
        interval("valid", Category::Compaction, 30, 40),
        open,
        interval("reverse", Category::Reasoning, 9, 8),
    ];

    let result = analyze(None, &input, &[window(10, 9)], input.len() + 1);

    assert_eq!(result.observed_window_ms, None);
    assert_eq!(result.covered_ms, None);
    assert_eq!(result.unclassified_ms, None);
    assert_eq!(result.coverage_ratio, None);
    assert_eq!(result.candidates, [3, 2, 1]);
    assert_eq!(result.complete_intervals, [0, 1, 0]);
    assert!(!result.partial);
    assert_eq!(result.issues.len(), 4);
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::Conflict(_)))
    );
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::Open(_)))
    );
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::Reversed(_)))
    );
    assert!(
        result
            .issues
            .iter()
            .any(|issue| matches!(issue, Issue::InvalidGap))
    );
}

#[test]
fn unavailable_window_still_stops_at_resource_limit() {
    let input = [interval("command", Category::Command, 0, 10)];

    let result = analyze(None, &input, &[], 0);

    assert_eq!(result.candidates, [0; 3]);
    assert_eq!(result.complete_intervals, [0; 3]);
    assert!(result.partial);
    assert_eq!(result.issues, [Issue::ResourceLimit]);
}

#[test]
fn reversed_window_retains_complete_interval_quality() {
    let input = [interval("command", Category::Command, 0, 10)];

    let result = analyze(Some(window(10, 0)), &input, &[], 1);

    assert_eq!(result.observed_window_ms, None);
    assert_eq!(result.covered_ms, None);
    assert_eq!(result.unclassified_ms, None);
    assert_eq!(result.coverage_ratio, None);
    assert_eq!(result.candidates, [1, 0, 0]);
    assert_eq!(result.complete_intervals, [1, 0, 0]);
    assert!(!result.partial);
    assert_eq!(result.issues, [Issue::InvalidWindow]);
}

#[test]
fn full_integer_domain_does_not_overflow() {
    let result = analyze(Some(window(i64::MIN, i64::MAX)), &[], &[], 0);
    assert_eq!(result.mask_ms[0], u64::MAX);
}
