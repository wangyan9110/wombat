//! Shared queries for both the interactive terminal and the non-interactive API.
use crate::adapters::{self, contract::*};
use crate::dto::operation_error;
use crate::usage_app_dto::*;
use crate::usage_store::{self, PricedMeasurement, Snapshot};
use anyhow::Result;
use chrono::{DateTime, Datelike, Duration, Months, NaiveDate, Utc};
use chrono_tz::Tz;
use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn invalid(message: impl Into<String>) -> anyhow::Error {
    operation_error("INVALID_ARGUMENT", message)
}
fn date(value: &str) -> Result<NaiveDate> {
    let result =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid("日期须为 YYYY-MM-DD"))?;
    if result.format("%Y-%m-%d").to_string() != value {
        return Err(invalid("日期须为 YYYY-MM-DD"));
    }
    Ok(result)
}
fn timezone(scope: &Scope) -> Result<Tz> {
    scope
        .timezone
        .as_deref()
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| invalid("无效时区"))
}
fn local_date(row: &PricedMeasurement, tz: Tz) -> Option<NaiveDate> {
    let timestamp = row.fact.timestamp.as_ref()?;
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|d| d.with_timezone(&tz).date_naive())
        .or_else(|| {
            if row.fact.time_precision == "date" {
                date(timestamp).ok()
            } else {
                None
            }
        })
}
fn checked_sum(
    rows: &[&PricedMeasurement],
    get: impl Fn(&TokenUsage) -> Option<u64>,
) -> Result<Option<u64>> {
    let mut sum = 0u64;
    let mut complete = true;
    for row in rows {
        if let Some(value) = get(&row.fact.tokens) {
            sum = sum
                .checked_add(value)
                .filter(|s| *s <= MAX_SAFE_INTEGER)
                .ok_or_else(|| operation_error("RESOURCE_LIMIT", "Token合计超出安全整数范围"))?;
        } else {
            complete = false;
        }
    }
    Ok(complete.then_some(sum))
}
pub fn summarize(rows: &[&PricedMeasurement]) -> Result<UsageSummary> {
    let input_total = checked_sum(rows, |t| {
        t.input?
            .checked_add(t.cache_read?)?
            .checked_add(t.cache_create?)
    })?;
    let cache_read = checked_sum(rows, |t| t.cache_read)?;
    Ok(UsageSummary {
        input_total,
        cache_hit_rate: share(cache_read, input_total),
        unpriced_tokens: unpriced_tokens(rows)?,
        tokens: TokenUsage {
            input: checked_sum(rows, |t| t.input)?,
            cache_read: checked_sum(rows, |t| t.cache_read)?,
            cache_create: checked_sum(rows, |t| t.cache_create)?,
            output: checked_sum(rows, |t| t.output)?,
            reasoning: checked_sum(rows, |t| t.reasoning)?,
            total: checked_sum(rows, |t| t.total)?,
            raw_input: checked_sum(rows, |t| t.raw_input)?,
        },
        price: if rows.len() == 1 {
            rows[0].price.clone()
        } else {
            crate::pricing::sum_prices(rows.iter().map(|r| &r.price))
                .map_err(|e| operation_error("PRICING_ERROR", e))?
        },
        measurement_count: rows.len(),
    })
}
fn share(value: Option<u64>, total: Option<u64>) -> Option<f64> {
    value
        .zip(total)
        .filter(|(_, t)| *t > 0)
        .map(|(v, t)| v as f64 / t as f64)
}
fn known_cost(summary: &UsageSummary) -> Option<Decimal> {
    if summary.measurement_count == 0 || summary.price.status.as_ref() == "unknown" {
        return None;
    }
    summary
        .price
        .cost
        .as_ref()
        .unwrap_or(&summary.price.known_cost)
        .parse()
        .ok()
}
fn unpriced_tokens(rows: &[&PricedMeasurement]) -> Result<Option<u64>> {
    let mut sum = 0u64;
    for row in rows {
        if row.price.components.is_empty() && row.price.status.as_ref() != "priced" {
            return Ok(None);
        }
        for component in &row.price.components {
            if component.cost.is_none() {
                let Some(tokens) = component.tokens else {
                    return Ok(None);
                };
                sum = sum
                    .checked_add(tokens)
                    .filter(|v| *v <= MAX_SAFE_INTEGER)
                    .ok_or_else(|| {
                        operation_error("RESOURCE_LIMIT", "未计价Token超出安全整数范围")
                    })?;
            }
        }
    }
    Ok(Some(sum))
}
fn cost_share(value: &UsageSummary, total: &UsageSummary) -> Option<f64> {
    known_cost(value)
        .zip(known_cost(total))
        .filter(|(_, total)| *total > Decimal::ZERO)
        .and_then(|(value, total)| (value / total).to_f64())
}
fn consumption_order(
    a: &UsageSummary,
    b: &UsageSummary,
    sort: &Option<Sort>,
) -> std::cmp::Ordering {
    if *sort == Some(Sort::Cost) {
        known_cost(b).cmp(&known_cost(a))
    } else {
        b.tokens.total.cmp(&a.tokens.total)
    }
}
fn dimensions(rows: &[&PricedMeasurement]) -> (Vec<String>, Vec<String>) {
    (
        rows.iter()
            .filter_map(|r| r.fact.model.raw.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        rows.iter()
            .filter_map(|r| r.fact.reasoning_effort.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
    )
}
fn matches(
    row: &PricedMeasurement,
    scope: &Scope,
    tz: Tz,
    projects: &BTreeMap<&str, Option<&str>>,
) -> bool {
    let r = &row.fact;
    if scope
        .agent_kind
        .as_ref()
        .is_some_and(|v| *v != r.agent_kind)
        || scope
            .source_instance_id
            .as_ref()
            .is_some_and(|v| *v != r.source_instance_id)
        || scope
            .thread_id
            .as_ref()
            .is_some_and(|v| r.thread_id.as_ref() != Some(v))
        || scope
            .model
            .as_ref()
            .is_some_and(|v| r.model.raw.as_ref() != Some(v))
        || scope
            .reasoning_effort
            .as_ref()
            .is_some_and(|v| r.reasoning_effort.as_ref() != Some(v))
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
fn available(rows: &[&PricedMeasurement], tz: Tz) -> AvailableRange {
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
fn quality(snapshot: &Snapshot, count: usize) -> Quality {
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
    if matches!(request.sort, Some(Sort::Recent)) && request.action != Action::Threads {
        return Err(invalid("recent排序仅适用于对话"));
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
pub fn dispatch(args: &Value) -> Result<Value> {
    let request: Request =
        serde_json::from_value(args.clone()).map_err(|e| invalid(format!("无效用量请求：{e}")))?;
    Ok(serde_json::to_value(execute(request)?)?)
}
pub fn execute(request: Request) -> Result<Response> {
    validate(&request)?;
    if request.action == Action::Refresh {
        let _lock = usage_store::RefreshLock::acquire()?;
        eprintln!("{}", serde_json::json!({"stage":"读取 Codex 日志"}));
        let collected = adapters::collect(
            &DiscoveryRequest {
                roots: request
                    .roots
                    .unwrap_or_default()
                    .into_iter()
                    .map(Into::into)
                    .collect(),
            },
            &RunContext::default(),
        );
        if collected.sources.iter().any(|s| s.status == "cancelled") {
            return Err(operation_error("CANCELLED", "更新已取消"));
        }
        let successes = collected
            .sources
            .iter()
            .any(|s| matches!(s.status.as_str(), "complete" | "partial"));
        if !successes
            && (!collected.issues.is_empty()
                || collected.sources.iter().any(|s| s.status == "failed"))
        {
            return Err(operation_error(
                "SOURCE_UNREADABLE",
                "没有可读取的来源，保留上次数据",
            ));
        }
        eprintln!("{}", serde_json::json!({"stage":"保存用量"}));
        let snapshot = usage_store::save(collected)?;
        let rows = snapshot.ledger()?;
        let selected = rows.iter().collect::<Vec<_>>();
        return Ok(Response {
            facets: None,
            distribution: None,
            price_update: None,
            freshness: None,
            output_version: 3,
            action: Action::Refresh,
            snapshot_ref: snapshot.manifest.snapshot_ref.clone(),
            scope: Scope::default(),
            available_range: available(&selected, chrono_tz::UTC),
            summary: summarize(&selected)?,
            items: vec![],
            page: Page {
                offset: 0,
                limit: 50,
                total: 0,
                next_offset: None,
            },
            quality: quality(&snapshot, selected.len()),
        });
    }
    let snapshot = usage_store::load(request.snapshot_id.as_deref())?;
    execute_snapshot(request, &snapshot)
}

pub(crate) fn execute_snapshot(request: Request, snapshot: &Snapshot) -> Result<Response> {
    let key = if snapshot.is_live() {
        // Default ranges roll over at midnight in the request timezone.
        Some(format!(
            "{}:{}",
            Utc::now()
                .with_timezone(&timezone(&request.scope)?)
                .date_naive(),
            serde_json::to_string(&request)?
        ))
    } else {
        None
    };
    if let Some(key) = &key
        && let Some(result) = snapshot.query_cache.lock().unwrap().get(key)
    {
        return Ok(result);
    }
    let result = execute_uncached(request, snapshot)?;
    if let Some(key) = key
        && let Some(bytes) = crate::query_cache::QueryCache::entry_size(&key, &result)
    {
        snapshot
            .query_cache
            .lock()
            .unwrap()
            .insert(key, &result, bytes);
    }
    Ok(result)
}

fn execute_uncached(mut request: Request, snapshot: &Snapshot) -> Result<Response> {
    validate(&request)?;
    let tz = timezone(&request.scope)?;
    request.scope.timezone = Some(tz.to_string());
    if let Some(id) = &request.thread_id {
        if request.scope.thread_id.as_ref().is_some_and(|s| s != id) {
            return Err(invalid("对话筛选身份冲突"));
        }
        request.scope.thread_id = Some(id.clone());
    }
    // Detail queries read only the requested thread/turn shard.
    let live_rows = if matches!(request.action, Action::Usage | Action::Threads) {
        snapshot.live_ledger()
    } else if matches!(request.action, Action::Turns | Action::Steps) {
        snapshot.live_detail_rows(
            request.thread_id.as_deref().unwrap(),
            request.turn_id.as_deref(),
        )?
    } else {
        None
    };
    let owned_rows = if live_rows.is_some() {
        vec![]
    } else if matches!(request.action, Action::Turns | Action::Steps)
        && snapshot.manifest.schema_version == 3
    {
        let id = request.thread_id.as_deref().unwrap();
        let thread = snapshot
            .manifest
            .threads
            .iter()
            .find(|t| t.thread.id == id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
        if request.action == Action::Steps {
            snapshot
                .turn(id, request.turn_id.as_deref().unwrap())?
                .measurements
        } else {
            let mut rows = vec![];
            for turn_id in thread.turns.keys() {
                rows.extend(snapshot.turn(id, turn_id)?.measurements);
            }
            rows
        }
    } else {
        snapshot.ledger()?
    };
    let rows = live_rows.unwrap_or_else(|| owned_rows.iter().collect());
    let projects = snapshot
        .manifest
        .threads
        .iter()
        .map(|t| (t.thread.id.as_str(), t.thread.project.as_deref()))
        .collect::<BTreeMap<_, _>>();
    let mut range_scope = request.scope.clone();
    range_scope.since = None;
    range_scope.until = None;
    let range_rows = rows
        .iter()
        .copied()
        .filter(|r| matches(r, &range_scope, tz, &projects))
        .collect::<Vec<_>>();
    let available_range = available(&range_rows, tz);
    // Resolve automatic report ranges here, shared by all entry points.
    if request.action == Action::Usage
        && request.scope.since.is_none()
        && request.scope.until.is_none()
        && request.scope.undated != Some(true)
        && request.scope.thread_id.is_none()
    {
        let today = Utc::now().with_timezone(&tz).date_naive();
        request.scope.since = Some(
            default_report_start(today, request.group.as_ref().unwrap_or(&Group::Day))?.to_string(),
        );
        request.scope.until = today.succ_opt().map(|d| d.to_string());
    }
    let search_ids = request.search.as_ref().map(|q| {
        let needle = q.to_lowercase();
        snapshot
            .manifest
            .threads
            .iter()
            .filter(|t| {
                t.thread.id.to_lowercase().contains(&needle)
                    || t.thread.upstream_id.to_lowercase().contains(&needle)
                    || t.thread
                        .title
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&needle)
                    || t.thread
                        .project
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&needle)
            })
            .map(|t| t.thread.id.as_str())
            .collect::<BTreeSet<_>>()
    });
    let selected = rows
        .iter()
        .copied()
        .filter(|r| {
            matches(r, &request.scope, tz, &projects)
                && search_ids.as_ref().is_none_or(|ids| {
                    r.fact
                        .thread_id
                        .as_deref()
                        .is_some_and(|id| ids.contains(id))
                })
        })
        .collect::<Vec<_>>();
    let mut summary = summarize(&selected)?;
    let dimensional = matches!(
        request.presentation,
        Some(Presentation::Projects | Presentation::Models)
    );
    let mut items = match request.action {
        Action::Usage if dimensional => dimension_items(&selected, &request, &projects, &summary)?,
        Action::Usage => usage_items(
            &selected,
            &request.scope,
            request.group.as_ref().unwrap_or(&Group::Day),
            tz,
            request.presentation != Some(Presentation::Distribution),
        )?,
        Action::Threads => thread_items(snapshot, &rows, &selected, &request)?,
        Action::Turns => {
            let all = rows
                .iter()
                .copied()
                .filter(|r| r.fact.thread_id.as_deref() == request.thread_id.as_deref())
                .collect::<Vec<_>>();
            summary = summarize(&all)?;
            turn_items(snapshot, &all, &selected, &request, &summary)?
        }
        Action::Steps => {
            let id = request.thread_id.as_deref().unwrap();
            let data = snapshot.turn(id, request.turn_id.as_deref().unwrap())?;
            summary = summarize(&data.measurements.iter().collect::<Vec<_>>())?;
            step_items(
                data,
                &summary,
                &request,
                &selected.iter().map(|r| r.fact.id.as_str()).collect(),
            )?
        }
        Action::Refresh => unreachable!(),
    };
    let limit = request.limit.unwrap_or(50);
    let located_turn = request.locate_turn_id.as_ref().and_then(|id| {
        items
            .iter()
            .position(|item| matches!(item, Item::Turn { id: current, .. } if current == id))
    });
    let offset = located_turn.or_else(|| request.locate_thread_id.as_ref().and_then(|id| items.iter().position(|item| matches!(item, Item::Thread { id: current, upstream_id, .. } if current == id || upstream_id.as_ref() == Some(id))))).map(|index| index / limit * limit).unwrap_or(request.offset.unwrap_or(0));
    let mut period_count = None;
    let distribution = if request.action == Action::Usage && !dimensional {
        let mut groups: Vec<Vec<Item>> = vec![];
        for item in items {
            if matches!(
                item,
                Item::Usage {
                    is_subtotal: true,
                    ..
                }
            ) {
                groups.push(vec![]);
            }
            groups.last_mut().unwrap().push(item);
        }
        fn group_usage(group: &[Item]) -> &UsageSummary {
            match &group[0] {
                Item::Usage { usage, .. } => usage,
                _ => unreachable!(),
            }
        }
        if matches!(request.sort, Some(Sort::Tokens | Sort::Cost)) {
            groups.sort_by(|a, b| consumption_order(group_usage(a), group_usage(b), &request.sort));
        }
        let max_tokens = groups
            .iter()
            .filter_map(|g| group_usage(g).tokens.total)
            .max();
        let max_cost = groups
            .iter()
            .filter_map(|g| known_cost(group_usage(g)))
            .max();
        let mut stats = Distribution {
            unpriced_tokens: unpriced_tokens(&selected)?,
            max_tokens,
            max_cost: max_cost.map(|v| v.to_string()),
            peak_token_dates: vec![],
            peak_cost_dates: vec![],
            peak_token_scopes: vec![],
            peak_cost_scopes: vec![],
        };
        if request.presentation.is_some() {
            period_count = Some(groups.len());
        }
        items = vec![];
        for (index, group) in groups.into_iter().enumerate() {
            for mut item in group {
                if let Item::Usage {
                    date,
                    scope,
                    is_subtotal,
                    usage,
                    share: ratio,
                    cost_share: money_ratio,
                    ..
                } = &mut item
                {
                    *ratio = share(usage.tokens.total, summary.tokens.total);
                    *money_ratio = cost_share(usage, &summary);
                    if *is_subtotal {
                        if max_tokens.is_some_and(|v| v > 0) && usage.tokens.total == max_tokens {
                            stats.peak_token_dates.push(date.clone());
                            stats.peak_token_scopes.push(scope.clone());
                        }
                        if max_cost.is_some_and(|v| v > Decimal::ZERO)
                            && known_cost(usage) == max_cost
                        {
                            stats.peak_cost_dates.push(date.clone());
                            stats.peak_cost_scopes.push(scope.clone());
                        }
                    } else if request.presentation == Some(Presentation::Distribution) {
                        continue;
                    }
                }
                if period_count.is_none() || (index >= offset && index - offset < limit) {
                    items.push(item);
                }
            }
        }
        Some(stats)
    } else {
        None
    };
    let total = period_count.unwrap_or(items.len());
    if period_count.is_none() {
        items = items.into_iter().skip(offset).take(limit).collect();
    }
    let next = offset.saturating_add(if period_count.is_some() {
        total.saturating_sub(offset).min(limit)
    } else {
        items.len()
    });
    Ok(Response {
        facets: (request.action == Action::Usage).then(|| {
            let (models, reasoning_efforts) = dimensions(&rows);
            Facets {
                directories: projects
                    .values()
                    .filter_map(|p| p.map(str::to_owned))
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                has_unassigned: rows.iter().any(|r| {
                    r.fact
                        .thread_id
                        .as_deref()
                        .and_then(|id| projects.get(id))
                        .copied()
                        .flatten()
                        .is_none()
                }),
                models,
                reasoning_efforts,
                agents: rows
                    .iter()
                    .map(|r| r.fact.agent_kind.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
            }
        }),
        distribution,
        price_update: None,
        freshness: None,
        output_version: 3,
        action: request.action,
        snapshot_ref: snapshot.manifest.snapshot_ref.clone(),
        scope: request.scope,
        available_range,
        summary,
        items,
        page: Page {
            offset,
            limit,
            total,
            next_offset: (next < total).then_some(next),
        },
        quality: quality(snapshot, selected.len()),
    })
}

fn default_report_start(today: NaiveDate, group: &Group) -> Result<NaiveDate> {
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

fn bucket(d: NaiveDate, group: &Group) -> Result<(NaiveDate, NaiveDate)> {
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
fn usage_items(
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
                    row.fact.model.raw.clone(),
                    row.fact.reasoning_effort.clone(),
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
fn dimension_items(
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
            row.fact.model.raw.clone()
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
fn group_measurements<'a>(
    rows: &[&'a PricedMeasurement],
    key: impl Fn(&'a PricedMeasurement) -> Option<&'a str>,
) -> BTreeMap<&'a str, Vec<&'a PricedMeasurement>> {
    let mut grouped = BTreeMap::<_, Vec<_>>::new();
    for &row in rows {
        if let Some(id) = key(row) {
            grouped.entry(id).or_default().push(row);
        }
    }
    grouped
}
fn thread_items(
    snapshot: &Snapshot,
    rows: &[&PricedMeasurement],
    selected: &[&PricedMeasurement],
    request: &Request,
) -> Result<Vec<Item>> {
    let search = request.search.as_deref().unwrap_or("").to_lowercase();
    let scoped = request.scope.project_unknown == Some(true)
        || request.scope.since.is_some()
        || request.scope.until.is_some()
        || request.scope.model.is_some()
        || request.scope.reasoning_effort.is_some()
        || request.scope.model_unknown == Some(true)
        || request.scope.effort_unknown == Some(true)
        || request.scope.undated == Some(true);
    let full_by_thread = group_measurements(rows, |r| r.fact.thread_id.as_deref());
    let matched_by_thread = group_measurements(selected, |r| r.fact.thread_id.as_deref());
    let mut result = vec![];
    for entry in &snapshot.manifest.threads {
        let t = &entry.thread;
        if request
            .scope
            .thread_id
            .as_ref()
            .is_some_and(|id| *id != t.id)
            || request
                .scope
                .project
                .as_ref()
                .is_some_and(|p| t.project.as_ref() != Some(p))
            || request
                .scope
                .agent_kind
                .as_ref()
                .is_some_and(|a| *a != t.agent_kind)
            || request
                .scope
                .source_instance_id
                .as_ref()
                .is_some_and(|s| *s != t.source_instance_id)
        {
            continue;
        }
        if request.scope.project_unknown == Some(true) && t.project.is_some() {
            continue;
        }
        if !search.is_empty()
            && !t.id.to_lowercase().contains(&search)
            && !t.upstream_id.to_lowercase().contains(&search)
            && !t
                .title
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains(&search)
            && !t
                .project
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains(&search)
        {
            continue;
        }
        let matched = matched_by_thread
            .get(t.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        if scoped && matched.is_empty() {
            continue;
        }
        let full = full_by_thread
            .get(t.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (models, reasoning_efforts) = dimensions(full);
        result.push(Item::Thread {
            upstream_id: Some(t.upstream_id.clone()),
            matched_last_activity_at: matched
                .iter()
                .filter_map(|r| r.fact.timestamp.clone())
                .max(),
            id: t.id.clone(),
            agent_kind: t.agent_kind.clone(),
            source_instance_id: t.source_instance_id.clone(),
            title: t.title.clone(),
            project: t.project.clone(),
            started_at: t.started_at.clone(),
            last_activity_at: t.last_activity_at.clone(),
            models,
            reasoning_efforts,
            matched_usage: summarize(matched)?,
            thread_usage: summarize(full)?,
        });
    }
    result.sort_by(|a, b| {
        let Item::Thread {
            id: aid,
            matched_usage: au,
            matched_last_activity_at: at,
            ..
        } = a
        else {
            unreachable!()
        };
        let Item::Thread {
            id: bid,
            matched_usage: bu,
            matched_last_activity_at: bt,
            ..
        } = b
        else {
            unreachable!()
        };
        if request.sort == Some(Sort::Recent) {
            bt.cmp(at).then(aid.cmp(bid))
        } else {
            consumption_order(au, bu, &request.sort)
                .then(bt.cmp(at))
                .then(aid.cmp(bid))
        }
    });
    Ok(result)
}
fn turn_items(
    snapshot: &Snapshot,
    full: &[&PricedMeasurement],
    selected: &[&PricedMeasurement],
    request: &Request,
    total: &UsageSummary,
) -> Result<Vec<Item>> {
    let id = request.thread_id.as_deref().unwrap();
    let entry = snapshot
        .manifest
        .threads
        .iter()
        .find(|t| t.thread.id == id)
        .ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
    if snapshot.manifest.schema_version != 3 {
        return Err(operation_error(
            "DETAIL_UNAVAILABLE",
            "旧快照没有轮次明细，请更新用量",
        ));
    }
    let full_by_turn = group_measurements(full, |r| {
        Some(r.fact.turn_id.as_deref().unwrap_or("unassigned"))
    });
    let matched_by_turn = group_measurements(selected, |r| {
        Some(r.fact.turn_id.as_deref().unwrap_or("unassigned"))
    });
    let mut result = vec![];
    for (turn_id, turn) in &entry.turns {
        let current = full_by_turn
            .get(turn_id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        let matched = matched_by_turn
            .get(turn_id.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default();
        if request.matched_only == Some(true) && matched.is_empty() {
            continue;
        }
        let usage = summarize(current)?;
        let ratio = share(usage.tokens.total, total.tokens.total);
        let (models, reasoning_efforts) = dimensions(current);
        result.push(Item::Turn {
            cost_share: cost_share(&usage, total),
            id: turn_id.clone(),
            thread_id: id.into(),
            ordinal: turn.turn.as_ref().map(|t| t.ordinal),
            started_at: turn.turn.as_ref().and_then(|t| t.started_at.clone()),
            ended_at: turn.turn.as_ref().and_then(|t| t.ended_at.clone()),
            status: turn
                .turn
                .as_ref()
                .map(|t| t.status.clone())
                .unwrap_or_else(|| "unknown".into()),
            models,
            reasoning_efforts,
            usage,
            matched_usage: summarize(matched)?,
            share: ratio,
        });
    }
    result.sort_by(|a, b| {
        let Item::Turn {
            id: ai,
            usage: au,
            started_at: at,
            ordinal: ao,
            ..
        } = a
        else {
            unreachable!()
        };
        let Item::Turn {
            id: bi,
            usage: bu,
            started_at: bt,
            ordinal: bo,
            ..
        } = b
        else {
            unreachable!()
        };
        if request.sort == Some(Sort::Time) {
            at.cmp(bt).then(ao.cmp(bo)).then(ai.cmp(bi))
        } else {
            consumption_order(au, bu, &request.sort)
                .then(at.cmp(bt))
                .then(ai.cmp(bi))
        }
    });
    Ok(result)
}
fn step_items(
    data: usage_store::TurnData,
    total: &UsageSummary,
    request: &Request,
    matched: &BTreeSet<&str>,
) -> Result<Vec<Item>> {
    let mut items = vec![];
    for row in data.measurements {
        let usage = summarize(&[&row])?;
        let r = std::sync::Arc::unwrap_or_clone(row.fact);
        items.push(Item::Measurement {
            matches_scope: matched.contains(r.id.as_str()),
            cost_share: cost_share(&usage, total),
            id: r.id,
            thread_id: r.thread_id,
            turn_id: r.turn_id,
            timestamp: r.timestamp,
            model: r.model.raw,
            reasoning_effort: r.reasoning_effort,
            share: share(usage.tokens.total, total.tokens.total),
            usage,
            sequence: r.sequence,
            time_precision: r.time_precision,
        });
    }
    for op in data.operations {
        items.push(Item::Operation {
            id: op.id,
            thread_id: op.thread_id,
            turn_id: op.turn_id,
            timestamp: op.timestamp,
            name: op.name,
            status: op.status,
            sequence: op.sequence,
            time_precision: op.time_precision,
            operation_type: op.kind,
            exit_code: op.exit_code,
            duration_ms: op.duration_ms,
            path: op.path,
            server: op.server,
            tool: op.tool,
        });
    }
    fn key(item: &Item) -> (&Option<String>, u64, &str) {
        match item {
            Item::Measurement {
                timestamp,
                sequence,
                id,
                ..
            }
            | Item::Operation {
                timestamp,
                sequence,
                id,
                ..
            } => (timestamp, *sequence, id),
            _ => unreachable!(),
        }
    }
    items.sort_by(|a, b| {
        if matches!(request.sort, Some(Sort::Tokens | Sort::Cost)) {
            match (a, b) {
                (Item::Measurement { usage: au, .. }, Item::Measurement { usage: bu, .. }) => {
                    return consumption_order(au, bu, &request.sort).then(key(a).cmp(&key(b)));
                }
                (Item::Measurement { .. }, _) => return std::cmp::Ordering::Less,
                (_, Item::Measurement { .. }) => return std::cmp::Ordering::Greater,
                _ => {}
            }
        }
        key(a).cmp(&key(b))
    });
    Ok(items)
}

#[cfg(test)]
mod report_range_tests {
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
}
