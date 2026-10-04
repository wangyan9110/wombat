use super::*;

#[test]
fn automatic_reports_cover_calendar_weeks_and_months_across_boundaries() {
    for (today, daily, weekly, monthly) in [
        ("2026-09-30", "2026-09-01", "2026-04-01", "2025-10-01"),
        ("2026-01-01", "2025-12-03", "2025-08-01", "2025-02-01"),
        ("2024-03-01", "2024-02-01", "2023-10-01", "2023-04-01"),
        ("2026-03-08", "2026-02-07", "2025-10-01", "2025-04-01"),
    ] {
        for (group, expected) in [
            (Group::Day, daily),
            (Group::Week, weekly),
            (Group::Month, monthly),
        ] {
            assert_eq!(
                default_report_start(date(today).unwrap(), &group).unwrap(),
                date(expected).unwrap()
            );
        }
    }
}
