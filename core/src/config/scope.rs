//! Configuration scope and ledger attribution filters.
use super::*;
pub(crate) fn validate(r: &Request) -> Result<()> {
    if r.limit.is_some_and(|n| n == 0 || n > 200)
        || r.offset.is_some_and(|n| n > MAX_SAFE_INTEGER as usize)
        || r.search.as_ref().is_some_and(|s| s.len() > 256)
        || r.roots.as_ref().is_some_and(|v| v.len() > 64)
        || r.project_roots.as_ref().is_some_and(|v| v.len() > 64)
    {
        return Err(operation_error("INVALID_ARGUMENT", "配置查询超出范围"));
    }
    if matches!(
        r.action,
        Action::Detail | Action::Evidence | Action::RelatedScopes
    ) && r.item_id.is_none()
    {
        return Err(operation_error("INVALID_ARGUMENT", "配置身份不能为空"));
    }
    if r.read_view.is_some() && r.snapshot_id.is_some() {
        return Err(operation_error("INVALID_ARGUMENT", "读取版本不能混用"));
    }
    normalize(&r.scope)?;
    Ok(())
}
pub(super) fn normalize(scope: &Scope) -> Result<(Scope, Tz)> {
    let tz: Tz = scope
        .timezone
        .as_deref()
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| operation_error("INVALID_ARGUMENT", "时区无效"))?;
    let today = Utc::now().with_timezone(&tz).date_naive();
    if scope.all_time == Some(true) {
        if scope.since.is_some() || scope.until.is_some() {
            return Err(operation_error(
                "INVALID_ARGUMENT",
                "全部日期不能与日期范围混用",
            ));
        }
        let mut out = scope.clone();
        out.timezone = Some(tz.to_string());
        return Ok((out, tz));
    }
    let parse = |s: &Option<String>, fallback: NaiveDate| -> Result<NaiveDate> {
        match s {
            Some(s) => NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| operation_error("INVALID_ARGUMENT", "日期无效")),
            None => Ok(fallback),
        }
    };
    let since = parse(&scope.since, today - chrono::Duration::days(29))?;
    let until = parse(&scope.until, today + chrono::Duration::days(1))?;
    if since >= until {
        return Err(operation_error("INVALID_ARGUMENT", "日期范围无效"));
    }
    let mut out = scope.clone();
    out.timezone = Some(tz.to_string());
    out.since = Some(since.to_string());
    out.until = Some(until.to_string());
    Ok((out, tz))
}
pub(super) fn in_time(at: Option<&str>, scope: &Scope, tz: Tz) -> bool {
    if scope.all_time == Some(true) {
        return true;
    }
    at.and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|at| {
            let date = at.with_timezone(&tz).date_naive().to_string();
            date >= *scope.since.as_ref().unwrap() && date < *scope.until.as_ref().unwrap()
        })
}
pub(super) fn applicable(item: &Item, scope: &Scope) -> bool {
    scope.agent_kind.as_deref().is_none_or(|a| a == "codex")
        && item.applies(
            scope.source_instance_id.as_deref(),
            scope.project.as_deref(),
        )
}

pub(super) fn matches_row(
    row: &PricedMeasurement,
    scope: &Scope,
    tz: Tz,
    projects: &BTreeMap<&str, Option<&str>>,
) -> bool {
    let f = &row.fact;
    in_time(f.timestamp.as_deref(), scope, tz)
        && scope
            .agent_kind
            .as_ref()
            .is_none_or(|a| a.as_str() == f.agent_kind.as_ref())
        && scope
            .source_instance_id
            .as_ref()
            .is_none_or(|s| s.as_str() == f.source_instance_id.as_ref())
        && scope
            .thread_id
            .as_ref()
            .is_none_or(|s| f.thread_id.as_deref() == Some(s.as_str()))
        && scope.project.as_ref().is_none_or(|p| {
            f.thread_id
                .as_deref()
                .and_then(|id| projects.get(id).copied().flatten())
                == Some(p.as_str())
        })
}
pub(super) fn usage(
    rows: &[&PricedMeasurement],
) -> Result<Option<crate::usage_app_dto::UsageSummary>> {
    if rows.is_empty() {
        Ok(None)
    } else {
        Ok(Some(crate::usage_app::summarize(rows)?))
    }
}

pub(crate) fn projects(r: &Request) -> Result<Vec<String>> {
    let mut roots = r.project_roots.clone().unwrap_or_default();
    roots.extend(crate::directories::authorized(
        crate::directories::Purpose::Project,
    )?);
    let mut out = BTreeSet::new();
    for root in roots {
        let p = std::fs::canonicalize(root)
            .map_err(|_| operation_error("INVALID_ARGUMENT", "项目读取根不可访问"))?;
        if !p.is_dir() {
            return Err(operation_error("INVALID_ARGUMENT", "项目读取根必须是目录"));
        }
        out.insert(p.to_string_lossy().into_owned());
    }
    Ok(out.into_iter().collect())
}
