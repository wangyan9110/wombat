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
        evidence_ids: vec![],
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
    assert_eq!(result.category_union_ms, [50, 30, 30, 0]);
    assert_eq!(result.category_sum_ms, [60, 30, 30, 0]);
    assert_eq!(
        result.mask_ms,
        [20, 30, 20, 0, 0, 20, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
    assert_eq!(result.covered_ms, Some(80));
    assert_eq!(result.coverage_ratio, Some(0.8));
    assert_eq!(result.gap_union_ms, 40);
    assert_eq!(
        result.gap_intersection_mask_ms,
        [0, 0, 20, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
    let only_gap = analyze(Some(window(0, 100)), &[], &[window(0, 40)], 1);
    assert_eq!(only_gap.unclassified_ms, Some(100));
    assert_eq!(only_gap.covered_ms, Some(0));
}

#[test]
fn four_categories_overlap_with_independent_gap_mask_truth() {
    let input = [
        interval("command", Category::Command, 0, 8),
        interval("compaction", Category::Compaction, 4, 12),
        interval("reasoning", Category::Reasoning, 6, 14),
        interval("mcp", Category::Mcp, 10, 18),
    ];
    let result = analyze(Some(window(0, 20)), &input, &[window(5, 13)], 5);

    assert_eq!(result.category_union_ms, [8, 8, 8, 8]);
    assert_eq!(result.category_sum_ms, [8, 8, 8, 8]);
    assert_eq!(
        result.mask_ms,
        [2, 4, 0, 2, 0, 0, 2, 2, 4, 0, 0, 0, 2, 0, 2, 0]
    );
    assert_eq!(result.covered_ms, Some(18));
    assert_eq!(result.unclassified_ms, Some(2));
    assert_eq!(result.coverage_ratio, Some(0.9));
    assert_eq!(result.gap_union_ms, 8);
    assert_eq!(
        result.gap_intersection_mask_ms,
        [0, 0, 0, 1, 0, 0, 2, 2, 0, 0, 0, 0, 1, 0, 2, 0]
    );
}

#[test]
fn mcp_only_and_gap_use_the_fourth_bit_without_classifying_unknown_time() {
    let result = analyze(
        Some(window(0, 10)),
        &[interval("mcp", Category::Mcp, 2, 7)],
        &[window(0, 4)],
        2,
    );

    assert_eq!(result.category_union_ms, [0, 0, 0, 5]);
    assert_eq!(result.category_sum_ms, [0, 0, 0, 5]);
    assert_eq!(
        result.mask_ms,
        [5, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0]
    );
    assert_eq!(result.covered_ms, Some(5));
    assert_eq!(result.unclassified_ms, Some(5));
    assert_eq!(result.gap_union_ms, 4);
    assert_eq!(
        result.gap_intersection_mask_ms,
        [2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn mcp_does_not_change_existing_category_unions_or_sums() {
    let input = [
        interval("compaction", Category::Compaction, 0, 30),
        interval("command-a", Category::Command, 30, 60),
        interval("command-b", Category::Command, 50, 80),
        interval("reasoning", Category::Reasoning, 20, 50),
        interval("mcp", Category::Mcp, 80, 90),
    ];
    let result = analyze(Some(window(0, 100)), &input, &[], 5);

    assert_eq!(result.category_union_ms[..3], [50, 30, 30]);
    assert_eq!(result.category_sum_ms[..3], [60, 30, 30]);
    assert_eq!(result.category_union_ms[3], 10);
    assert_eq!(result.category_sum_ms[3], 10);
    assert_eq!(result.mask_ms[0], 10);
    assert_eq!(result.mask_ms[8], 10);
    assert_eq!(result.covered_ms, Some(90));
    assert_eq!(result.unclassified_ms, Some(10));
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
    assert_eq!(result.category_sum_ms, [20, 0, 0, 0]);
    assert_eq!(result.category_union_ms, [20, 0, 0, 0]);
    assert_eq!(result.complete_intervals, [2, 0, 1, 0]);
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
    assert_eq!(result.category_union_ms, [0, 20, 0, 0]);
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
    assert_eq!(result.candidates, [3, 2, 1, 0]);
    assert_eq!(result.complete_intervals, [0, 1, 0, 0]);
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

    assert_eq!(result.candidates, [0; CATEGORY_COUNT]);
    assert_eq!(result.complete_intervals, [0; CATEGORY_COUNT]);
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
    assert_eq!(result.candidates, [1, 0, 0, 0]);
    assert_eq!(result.complete_intervals, [1, 0, 0, 0]);
    assert!(!result.partial);
    assert_eq!(result.issues, [Issue::InvalidWindow]);
}

#[test]
fn full_integer_domain_does_not_overflow() {
    let result = analyze(Some(window(i64::MIN, i64::MAX)), &[], &[], 0);
    assert_eq!(result.mask_ms[0], u64::MAX);
}

#[test]
fn timeline_relative_tracks_zero_clipping_and_merged_unknown_gaps() {
    let result = analyze(
        Some(window(100, 200)),
        &[
            interval("clipped", Category::Command, 90, 140),
            interval("point", Category::Reasoning, 150, 150),
            interval("outside", Category::Compaction, 201, 210),
        ],
        &[window(145, 160), window(180, 190)],
        5,
    );
    assert_eq!(result.timeline.track_count, 2);
    assert_eq!(result.timeline.outside_count, 1);
    assert_eq!(result.timeline.gap_count, 1);
    assert_eq!(result.timeline.gaps, [(40, 100)]);
    assert_eq!(
        (
            result.timeline.tracks[0].start_ms,
            result.timeline.tracks[0].end_ms
        ),
        (0, 40)
    );
    assert!(result.timeline.tracks[0].clipped);
    assert_eq!(
        (
            result.timeline.tracks[1].start_ms,
            result.timeline.tracks[1].end_ms
        ),
        (50, 50)
    );
    assert_eq!(result.unclassified_ms, Some(60));
    assert_eq!(result.category_sum_ms, [40, 0, 0, 0]);
}

#[test]
fn timeline_combined_limit_omits_whole_detail_but_retains_complete_totals() {
    let inputs: Vec<_> = (0..200)
        .map(|n| interval(&format!("i{n:03}"), Category::Command, n, n + 1))
        .collect();
    let exact = analyze(Some(window(0, 200)), &inputs, &[], 200);
    assert_eq!(exact.timeline.tracks.len(), 200);
    assert!(!exact.timeline.limited);
    let over = analyze(Some(window(0, 201)), &inputs, &[], 200);
    assert!(over.timeline.limited);
    assert!(over.timeline.tracks.is_empty() && over.timeline.gaps.is_empty());
    assert_eq!(
        (over.timeline.track_count, over.timeline.gap_count),
        (200, 1)
    );
    assert_eq!(over.category_sum_ms, [200, 0, 0, 0]);
    assert_eq!(over.category_union_ms, [200, 0, 0, 0]);
    assert_eq!(over.unclassified_ms, Some(1));
    assert!(!over.partial);
    let alternating: Vec<_> = (0..150)
        .map(|n| interval(&format!("i{n:03}"), Category::Command, n * 2 + 1, n * 2 + 2))
        .collect();
    let mixed = analyze(Some(window(0, 301)), &alternating, &[], 150);
    assert!(mixed.timeline.limited);
    assert_eq!(
        (mixed.timeline.track_count, mixed.timeline.gap_count),
        (150, 151)
    );
    assert!(mixed.timeline.tracks.is_empty() && mixed.timeline.gaps.is_empty());
    assert_eq!(mixed.unclassified_ms, Some(151));
}

#[test]
fn timeline_duplicate_proof_ids_do_not_create_interval_conflicts() {
    let mut first = interval("same", Category::Command, 1, 9);
    first.evidence_ids = vec!["one".into()];
    let mut duplicate = first.clone();
    duplicate.evidence_ids = vec!["two".into()];
    let result = analyze(Some(window(0, 10)), &[first, duplicate], &[], 2);
    assert_eq!(result.timeline.track_count, 1);
    assert_eq!(result.timeline.tracks[0].evidence_ids, ["one"]);
    assert!(result.issues.is_empty());
}
