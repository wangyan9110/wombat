//! Calendar reports and dimension distributions from the shared filtered ledger.
use super::*;
pub(super) fn default_report_start(today: NaiveDate, group: &Group) -> Result<NaiveDate> {
    let start = match group {
        Group::Day => today.checked_sub_signed(Duration::days(29)),
        Group::Week => today
            .with_day(1)
            .and_then(|d| d.checked_sub_months(Months::new(5))),
        Group::Month => today
            .with_day(1)
            .and_then(|d| d.checked_sub_months(Months::new(11))),
    };
    start.ok_or_else(|| invalid("日期超出范围"))
}

pub(super) fn bucket(d: NaiveDate, group: &Group) -> Result<(NaiveDate, NaiveDate)> {
    let start = match group {
        Group::Day => d,
        Group::Week => d - Duration::days(d.weekday().num_days_from_monday().into()),
        Group::Month => d.with_day(1).unwrap(),
    };
    let end = match group {
        Group::Day => start.succ_opt(),
        Group::Week => start.checked_add_signed(Duration::days(7)),
        Group::Month => {
            if start.month() == 12 {
                NaiveDate::from_ymd_opt(start.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(start.year(), start.month() + 1, 1)
            }
        }
    }
    .ok_or_else(|| invalid("日期超出范围"))?;
    Ok((start, end))
}
pub(super) fn usage_items(
    rows: &[&PricedMeasurement],
    scope: &Scope,
    group: &Group,
    tz: Tz,
    details: bool,
) -> Result<Vec<Item>> {
    let mut buckets: BTreeMap<Option<(NaiveDate, NaiveDate)>, Vec<&PricedMeasurement>> =
        BTreeMap::new();
    for row in rows {
        let key = local_date(row, tz).map(|d| bucket(d, group)).transpose()?;
        buckets.entry(key).or_default().push(row);
    }
    let mut items = vec![];
    for (period, rows) in buckets.into_iter().rev() {
        let mut subset = scope.clone();
        if let Some((start, end)) = period {
            let start = start.to_string();
            let end = end.to_string();
            subset.since = Some(
                scope
                    .since
                    .as_ref()
                    .map_or(start.clone(), |s| s.max(&start).clone()),
            );
            subset.until = Some(
                scope
                    .until
                    .as_ref()
                    .map_or(end.clone(), |s| s.min(&end).clone()),
            );
        } else {
            subset.undated = Some(true);
            subset.since = None;
            subset.until = None;
        }
        let display_start = subset.since.clone();
        let display_end = subset
            .until
            .as_ref()
            .and_then(|d| date(d).ok()?.pred_opt())
            .map(|d| d.to_string());
        items.push(Item::Usage {
            share: None,
            cost_share: None,
            date: display_start.clone(),
            end_date: display_end.clone(),
            is_subtotal: true,
            model: None,
            reasoning_effort: None,
            usage: summarize(&rows)?,
            scope: subset.clone(),
        });
        if !details {
            continue;
        }
        let mut groups: BTreeMap<(Option<String>, Option<String>), Vec<&PricedMeasurement>> =
            BTreeMap::new();
        for row in &rows {
            groups
                .entry((
                    row.fact.model.raw.as_deref().map(str::to_owned),
                    row.fact.reasoning_effort.as_deref().map(str::to_owned),
                ))
                .or_default()
                .push(row);
        }
        for ((model, effort), rows) in groups {
            let mut specific = subset.clone();
            specific.model = model.clone();
            specific.model_unknown = model.is_none().then_some(true);
            specific.reasoning_effort = effort.clone();
            specific.effort_unknown = effort.is_none().then_some(true);
            items.push(Item::Usage {
                share: None,
                cost_share: None,
                date: display_start.clone(),
                end_date: display_end.clone(),
                is_subtotal: false,
                model,
                reasoning_effort: effort,
                usage: summarize(&rows)?,
                scope: specific,
            });
        }
    }
    Ok(items)
}
pub(super) fn dimension_items(
    rows: &[&PricedMeasurement],
    request: &Request,
    projects: &BTreeMap<&str, Option<&str>>,
    total: &UsageSummary,
) -> Result<Vec<Item>> {
    let mut groups: BTreeMap<Option<String>, Vec<&PricedMeasurement>> = BTreeMap::new();
    let by_project = request.presentation == Some(Presentation::Projects);
    for row in rows {
        let key = if by_project {
            row.fact
                .thread_id
                .as_deref()
                .and_then(|id| projects.get(id))
                .copied()
                .flatten()
                .map(str::to_owned)
        } else {
            row.fact.model.raw.as_deref().map(str::to_owned)
        };
        groups.entry(key).or_default().push(row);
    }
    let mut items = vec![];
    for (key, rows) in groups {
        let usage = summarize(&rows)?;
        let mut scope = request.scope.clone();
        if by_project {
            scope.project = key.clone();
            scope.project_unknown = key.is_none().then_some(true);
        } else {
            scope.model = key.clone();
            scope.model_unknown = key.is_none().then_some(true);
        }
        items.push(Item::Usage {
            date: None,
            end_date: None,
            is_subtotal: true,
            model: if by_project { None } else { key },
            reasoning_effort: None,
            share: share(usage.tokens.total, total.tokens.total),
            cost_share: cost_share(&usage, total),
            usage,
            scope,
        });
    }
    items.sort_by(|a, b| {
        let Item::Usage { usage: a, .. } = a else {
            unreachable!()
        };
        let Item::Usage { usage: b, .. } = b else {
            unreachable!()
        };
        consumption_order(a, b, &request.sort)
    });
    Ok(items)
}
