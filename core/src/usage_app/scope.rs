//! Query validation, timezones, filtering and coverage.
use super::*;
pub(super) fn invalid(message: impl Into<String>) -> anyhow::Error {
    operation_error("INVALID_ARGUMENT", message)
}
pub(super) fn date(value: &str) -> Result<NaiveDate> {
    let result =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid("日期须为 YYYY-MM-DD"))?;
    if result.format("%Y-%m-%d").to_string() != value {
        return Err(invalid("日期须为 YYYY-MM-DD"));
    }
    Ok(result)
}
pub(super) fn timezone(scope: &Scope) -> Result<Tz> {
    scope
        .timezone
        .as_deref()
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| invalid("无效时区"))
}
pub(super) fn local_date(row: &PricedMeasurement, tz: Tz) -> Option<NaiveDate> {
    let timestamp = row.fact.timestamp.as_ref()?;
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|d| d.with_timezone(&tz).date_naive())
        .or_else(|| {
            if row.fact.time_precision.as_ref() == "date" {
                date(timestamp).ok()
            } else {
                None
            }
        })
}
pub(super) fn dimensions(rows: &[&PricedMeasurement]) -> (Vec<String>, Vec<String>) {
    (
        rows.iter()
            .filter_map(|r| r.fact.model.raw.as_deref())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(str::to_owned)
            .collect(),
        rows.iter()
            .filter_map(|r| r.fact.reasoning_effort.as_deref())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(str::to_owned)
            .collect(),
    )
}
pub(super) fn matches(
    row: &PricedMeasurement,
    scope: &Scope,
    tz: Tz,
    projects: &BTreeMap<&str, Option<&str>>,
) -> bool {
    let r = &row.fact;
    if scope
        .agent_kind
        .as_ref()
        .is_some_and(|v| v.as_str() != r.agent_kind.as_ref())
        || scope
            .source_instance_id
            .as_ref()
            .is_some_and(|v| v.as_str() != r.source_instance_id.as_ref())
        || scope
            .thread_id
            .as_ref()
            .is_some_and(|v| r.thread_id.as_deref() != Some(v.as_str()))
        || scope
            .model
            .as_ref()
            .is_some_and(|v| r.model.raw.as_deref() != Some(v.as_str()))
        || scope
            .reasoning_effort
            .as_ref()
            .is_some_and(|v| r.reasoning_effort.as_deref() != Some(v.as_str()))
    {
        return false;
    }
    if scope.model_unknown == Some(true) && r.model.raw.is_some()
        || scope.effort_unknown == Some(true) && r.reasoning_effort.is_some()
    {
        return false;
    }
    if scope.project_unknown == Some(true)
        && r.thread_id
            .as_deref()
            .and_then(|id| projects.get(id))
            .copied()
            .flatten()
            .is_some()
    {
        return false;
    }
    if scope.project.as_ref().is_some_and(|v| {
        r.thread_id
            .as_deref()
            .and_then(|id| projects.get(id))
            .copied()
            .flatten()
            != Some(v.as_str())
    }) {
        return false;
    }
    let local = local_date(row, tz).map(|d| d.to_string());
    if scope.undated == Some(true) {
        return local.is_none();
    }
    if scope
        .since
        .as_ref()
        .is_some_and(|since| local.as_ref().is_none_or(|d| d < since))
        || scope
            .until
            .as_ref()
            .is_some_and(|until| local.as_ref().is_none_or(|d| d >= until))
    {
        return false;
    }
    true
}
pub(super) fn available(rows: &[&PricedMeasurement], tz: Tz) -> AvailableRange {
    let dates = rows
        .iter()
        .filter_map(|r| local_date(r, tz))
        .collect::<BTreeSet<_>>();
    AvailableRange {
        since: dates.first().map(ToString::to_string),
        until: dates
            .last()
            .and_then(|d| d.succ_opt())
            .map(|d| d.to_string()),
    }
}
pub(super) fn quality(snapshot: &Snapshot, count: usize) -> Quality {
    let sources = &snapshot.manifest.sources;
    let partial = !snapshot.manifest.issues.is_empty()
        || sources
            .iter()
            .any(|s| matches!(s.status.as_str(), "partial" | "failed" | "cancelled"));
    Quality {
        status: if partial {
            "partial"
        } else if count == 0 {
            "empty"
        } else {
            "complete"
        }
        .into(),
        issues: snapshot.manifest.issues.clone(),
        sources: sources.clone(),
    }
}
pub(crate) fn validate(request: &Request) -> Result<()> {
    timezone(&request.scope)?;
    super::comparison::validate_comparison(request)?;
    super::inspection::validate(request)?;
    if request.scope.all_time == Some(true)
        && (request.scope.since.is_some()
            || request.scope.until.is_some()
            || request.scope.undated == Some(true))
    {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "全部日期不能与日期范围混用",
        ));
    }
    if let Some(d) = &request.scope.since {
        date(d)?;
    }
    if let Some(d) = &request.scope.until {
        date(d)?;
    }
    if request
        .scope
        .since
        .as_ref()
        .zip(request.scope.until.as_ref())
        .is_some_and(|(a, b)| a >= b)
    {
        return Err(invalid("起始日期必须早于结束日期（不含）"));
    }
    if request.limit.is_some_and(|n| n == 0 || n > 500)
        || request
            .offset
            .is_some_and(|n| n > MAX_SAFE_INTEGER as usize)
    {
        return Err(invalid("分页limit须为1至500，offset为安全非负整数"));
    }
    if request.roots.is_some() && request.action != Action::Refresh {
        return Err(invalid("来源根仅适用于更新"));
    }
    if request.action == Action::Refresh
        && (request.snapshot_id.is_some()
            || request.thread_id.is_some()
            || request.turn_id.is_some()
            || request.group.is_some()
            || request.sort.is_some()
            || request.presentation.is_some()
            || request.search.is_some()
            || request.offset.is_some()
            || request.limit.is_some()
            || request.locate_thread_id.is_some()
            || request.locate_turn_id.is_some()
            || request.locate_operation_id.is_some()
            || request.matched_only.is_some()
            || serde_json::to_value(&request.scope)?
                .as_object()
                .is_some_and(|o| o.values().any(|v| !v.is_null())))
    {
        return Err(invalid("更新不接受查询筛选参数"));
    }
    if request.group.is_some() && request.action != Action::Usage {
        return Err(invalid("分组仅适用于用量"));
    }
    if request.presentation.is_some() && request.action != Action::Usage {
        return Err(invalid("展示分组仅适用于用量"));
    }
    if request.locate_operation_id.is_some() && request.action != Action::Steps {
        return Err(invalid("操作定位仅适用于轮次记录"));
    }
    if request.locate_thread_id.is_some() && request.action != Action::Threads {
        return Err(invalid("定位仅适用于对话"));
    }
    if (request.locate_turn_id.is_some() || request.matched_only.is_some())
        && request.action != Action::Turns
    {
        return Err(invalid("轮次定位和匹配筛选仅适用于轮次"));
    }
    if request.scope.project_unknown == Some(true) && request.scope.project.is_some() {
        return Err(invalid("未知项目与具体项目冲突"));
    }
    if request.search.is_some() && request.action != Action::Threads {
        return Err(invalid("搜索仅适用于对话"));
    }
    if matches!(request.action, Action::Turns | Action::Steps)
        && request.thread_id.as_deref().is_none_or(str::is_empty)
    {
        return Err(invalid("需要threadId"));
    }
    if request.action == Action::Steps && request.turn_id.as_deref().is_none_or(str::is_empty) {
        return Err(invalid("需要turnId"));
    }
    if request.turn_id.is_some() && request.action != Action::Steps {
        return Err(invalid("turnId仅适用于步骤"));
    }
    if matches!(request.sort, Some(Sort::Recent))
        && !matches!(request.action, Action::Threads | Action::Turns)
    {
        return Err(invalid("recent排序仅适用于对话或轮次"));
    }
    if matches!(request.sort, Some(Sort::Time)) && request.action == Action::Threads {
        return Err(invalid("对话排序使用tokens或recent"));
    }
    if request.scope.undated == Some(true)
        && (request.scope.since.is_some() || request.scope.until.is_some())
    {
        return Err(invalid("未知日期不能同时指定日期范围"));
    }
    if request.scope.model_unknown == Some(true) && request.scope.model.is_some()
        || request.scope.effort_unknown == Some(true) && request.scope.reasoning_effort.is_some()
    {
        return Err(invalid("未知维度与具体值冲突"));
    }
    Ok(())
}
