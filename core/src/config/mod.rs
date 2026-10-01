//! Version-pinned configuration inventory and evidence queries, sharing the usage ledger.
mod scan;
use crate::{
    adapters::contract::{AgentAdapter, DiscoveryRequest, MAX_SAFE_INTEGER},
    config_dto::*,
    dto::operation_error,
    usage_store::{PricedMeasurement, Snapshot},
};
use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(crate) struct View {
    pub snapshot: Option<Arc<Snapshot>>,
    pub items: Vec<Item>,
    pub issues: Vec<Issue>,
    pub projects: Vec<String>,
    pub roots: Vec<String>,
    pub project_roots: Vec<String>,
    pub revision: String,
    pub checked: String,
    pub history_status: String,
}
#[derive(Default)]
pub(crate) struct Store {
    views: VecDeque<(String, Instant, Arc<View>)>,
}
impl Store {
    pub fn has_views(&mut self) -> bool {
        self.views
            .retain(|(_, at, _)| at.elapsed() < Duration::from_secs(600));
        !self.views.is_empty()
    }
    pub fn get(&mut self, id: &str) -> Result<Arc<View>> {
        self.has_views();
        self.views
            .iter()
            .find(|(key, _, _)| key == id)
            .map(|(_, _, v)| Arc::clone(v))
            .ok_or_else(|| operation_error("VIEW_EXPIRED", "配置读取版本已过期，请刷新"))
    }
    pub fn snapshot(&mut self, id: &str) -> Option<(Arc<Snapshot>, String)> {
        self.has_views();
        self.views.iter().find_map(|(_, _, view)| {
            let snapshot = view.snapshot.as_ref()?;
            (snapshot.manifest.snapshot_ref.snapshot_id == id)
                .then(|| (Arc::clone(snapshot), view.checked.clone()))
        })
    }
    pub fn insert(&mut self, view: View) -> (String, Arc<View>) {
        let id = format!("config:{}", uuid::Uuid::new_v4());
        let view = Arc::new(view);
        while self.views.len() >= 8 {
            self.views.pop_front();
        }
        self.views
            .push_back((id.clone(), Instant::now(), Arc::clone(&view)));
        (id, view)
    }
}
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
fn normalize(scope: &Scope) -> Result<(Scope, Tz)> {
    let tz: Tz = scope
        .timezone
        .as_deref()
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| operation_error("INVALID_ARGUMENT", "时区无效"))?;
    let today = Utc::now().with_timezone(&tz).date_naive();
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
fn in_time(at: Option<&str>, scope: &Scope, tz: Tz) -> bool {
    at.and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|at| {
            let date = at.with_timezone(&tz).date_naive().to_string();
            date >= *scope.since.as_ref().unwrap() && date < *scope.until.as_ref().unwrap()
        })
}
pub(crate) fn prepare(
    r: &Request,
    snapshot: Option<Arc<Snapshot>>,
    history_status: String,
) -> Result<View> {
    // Serialize inventory refreshes, not usage queries or reads of retained views.
    static REFRESH: Mutex<()> = Mutex::new(());
    let _refresh = REFRESH.lock().unwrap_or_else(|e| e.into_inner());
    let roots = r.roots.clone().unwrap_or_default();
    let sources = crate::adapters::codex::CodexAdapter
        .discover(&DiscoveryRequest {
            roots: roots.iter().map(PathBuf::from).collect(),
        })
        .sources;
    let mut projects = vec![];
    for root in r.project_roots.clone().unwrap_or_default() {
        let p = std::fs::canonicalize(root)
            .map_err(|_| operation_error("INVALID_ARGUMENT", "项目读取根不可访问"))?;
        if !p.is_dir() {
            return Err(operation_error("INVALID_ARGUMENT", "项目读取根必须是目录"));
        }
        projects.push(p.to_string_lossy().into_owned());
    }
    projects.sort();
    projects.dedup();
    let checked = Utc::now().to_rfc3339();
    let mut inventory = scan::scan(&sources, &projects, &checked);
    let cache_key = crate::hash(serde_json::to_vec(&(
        sources.iter().map(|s| &s.id).collect::<Vec<_>>(),
        &projects,
    ))?);
    let cache = crate::storage::data_home()?
        .join("config-v1")
        .join(format!("{cache_key}.json"));
    // Only safe metadata is retained, never config text, env values or command arguments.
    if let Ok(metadata) = std::fs::metadata(&cache)
        && metadata.len() <= 16 * 1024 * 1024
        && let Ok(bytes) = std::fs::read(&cache)
        && bytes.len() <= 16 * 1024 * 1024
        && let Ok(prior) = serde_json::from_slice::<Vec<Item>>(&bytes)
    {
        let ids = inventory
            .items
            .iter()
            .map(|i| i.id.clone())
            .collect::<BTreeSet<_>>();
        for mut item in prior {
            if ids.contains(&item.id) {
                continue;
            }
            item.stale = inventory.issues.iter().any(|issue| {
                issue
                    .path
                    .as_ref()
                    .is_some_and(|p| PathBuf::from(&item.path).starts_with(p))
                    && issue.code != "effectiveConfigUnknown"
            });
            item.current = item.stale;
            item.counts = Counts::default();
            item.usage = None;
            item.related_turns = 0;
            item.observation = Observation::Unknown;
            if inventory.items.len() < 20_000 {
                inventory.items.push(item);
            }
        }
    }
    inventory.items.sort_by(|a, b| a.id.cmp(&b.id));
    let metadata = serde_json::to_vec(&inventory.items)?;
    if metadata.len() > 16 * 1024 * 1024 {
        inventory.issues.push(Issue {
            code: "resourceLimited".into(),
            path: None,
        });
    } else if crate::storage::atomic_write(&cache, &metadata).is_err() {
        inventory.issues.push(Issue {
            code: "inventoryCacheUnavailable".into(),
            path: None,
        });
    }
    let revision = crate::hash(serde_json::to_vec(
        &inventory
            .items
            .iter()
            .map(|i| (&i.id, &i.content_hash, i.current, i.stale))
            .collect::<Vec<_>>(),
    )?);
    Ok(View {
        snapshot,
        items: inventory.items,
        issues: inventory.issues,
        projects,
        roots,
        project_roots: r.project_roots.clone().unwrap_or_default(),
        revision,
        checked,
        history_status,
    })
}
fn applicable(item: &Item, scope: &Scope) -> bool {
    scope.agent_kind.as_deref().is_none_or(|a| a == "codex")
        && scope
            .source_instance_id
            .as_ref()
            .is_none_or(|s| s == &item.source_instance_id)
        && scope
            .project
            .as_ref()
            .is_none_or(|p| item.project.as_ref().is_none_or(|v| v == p))
}
fn matches_row(
    row: &PricedMeasurement,
    scope: &Scope,
    tz: Tz,
    projects: &BTreeMap<&str, Option<&str>>,
) -> bool {
    let f = &row.fact;
    in_time(f.timestamp.as_deref(), scope, tz)
        && scope.agent_kind.as_ref().is_none_or(|a| a == &f.agent_kind)
        && scope
            .source_instance_id
            .as_ref()
            .is_none_or(|s| s == &f.source_instance_id)
        && scope
            .thread_id
            .as_ref()
            .is_none_or(|s| f.thread_id.as_ref() == Some(s))
        && scope.project.as_ref().is_none_or(|p| {
            f.thread_id
                .as_deref()
                .and_then(|id| projects.get(id).copied().flatten())
                == Some(p.as_str())
        })
}
fn usage(rows: &[&PricedMeasurement]) -> Result<Option<crate::usage_app_dto::UsageSummary>> {
    if rows.is_empty() {
        Ok(None)
    } else {
        Ok(Some(crate::usage_app::summarize(rows)?))
    }
}
pub(crate) fn capabilities() -> Response {
    Response {
        output_version: 1,
        action: Action::Capabilities,
        capabilities: Capabilities::default(),
        read_view: None,
        usage_revision: None,
        config_revision: String::new(),
        checked_at: Utc::now().to_rfc3339(),
        scope: Scope::default(),
        authorized_projects: vec![],
        summary: Summary {
            current_items: 0,
            historical_items: 0,
            observed_items: 0,
            usage: None,
        },
        items: vec![],
        evidence: vec![],
        related_scopes: vec![],
        page: crate::usage_app_dto::Page {
            offset: 0,
            limit: 50,
            total: 0,
            next_offset: None,
        },
        coverage: Coverage {
            status: "complete".into(),
            history_status: "notRequested".into(),
            issues: vec![],
            supported_evidence: Capabilities::default().evidence_types,
            absence_observable: false,
        },
    }
}
pub(crate) fn execute(r: Request, id: String, view: &View) -> Result<Response> {
    validate(&r)?;
    let (scope, tz) = normalize(&r.scope)?;
    let mut result = capabilities();
    result.action = r.action.clone();
    result.scope = scope.clone();
    result.checked_at = view.checked.clone();
    result.read_view = Some(id);
    result.config_revision = view.revision.clone();
    result.authorized_projects = view.projects.clone();
    result.usage_revision = view
        .snapshot
        .as_ref()
        .map(|s| s.manifest.snapshot_ref.snapshot_id.clone());
    result.coverage.history_status = if view.snapshot.as_ref().is_some_and(|s| {
        !s.manifest.issues.is_empty()
            || s.manifest
                .sources
                .iter()
                .any(|s| s.status != "complete" || !s.issues.is_empty())
    }) {
        "partial".into()
    } else {
        view.history_status.clone()
    };
    result.coverage.issues = view.issues.clone();
    // Config precedence, explicit adoption and missing event types cannot prove absence.
    result.coverage.status = "partial".into();
    result.coverage.issues.push(Issue {
        code: "historyCoverageUnknown".into(),
        path: None,
    });
    if scope
        .project
        .as_ref()
        .is_some_and(|p| !view.projects.contains(p))
    {
        result.coverage.issues.push(Issue {
            code: "projectNotAuthorized".into(),
            path: scope.project.clone(),
        });
        return Ok(result);
    }
    let mut items = view
        .items
        .iter()
        .filter(|i| applicable(i, &scope))
        .cloned()
        .collect::<Vec<_>>();
    let mut evidence = vec![];
    let mut related = BTreeMap::<Option<String>, (usize, BTreeSet<usize>)>::new();
    if let Some(snapshot) = &view.snapshot {
        let threads = snapshot
            .manifest
            .threads
            .iter()
            .map(|t| (t.thread.id.as_str(), &t.thread))
            .collect::<BTreeMap<_, _>>();
        let projects = threads
            .iter()
            .map(|(id, t)| (*id, t.project.as_deref()))
            .collect::<BTreeMap<_, _>>();
        let ledger = snapshot.live_ledger().unwrap_or_default();
        let mut turns = BTreeMap::<(&str, &str), Vec<usize>>::new();
        for (n, row) in ledger.iter().enumerate() {
            if let (Some(t), Some(u)) = (&row.fact.thread_id, &row.fact.turn_id) {
                turns.entry((t, u)).or_default().push(n);
            }
        }
        let mut paths = BTreeMap::<(String, String), Vec<usize>>::new();
        let mut servers = BTreeMap::<(String, String), Vec<usize>>::new();
        for (n, item) in items.iter().enumerate() {
            if item.kind == Kind::Mcp {
                servers
                    .entry((
                        item.source_instance_id.clone(),
                        item.native_key.clone().unwrap_or_default(),
                    ))
                    .or_default()
                    .push(n);
            } else {
                paths
                    .entry((item.source_instance_id.clone(), item.path.clone()))
                    .or_default()
                    .push(n);
            }
        }
        let mut item_rows = vec![BTreeSet::<usize>::new(); items.len()];
        let mut item_turns = vec![BTreeSet::<String>::new(); items.len()];
        let mut seen = BTreeSet::new();
        for op in snapshot.operation_facts() {
            if !seen.insert(op.id.as_str()) {
                continue;
            }
            let Some(thread) = threads.get(op.thread_id.as_str()) else {
                continue;
            };
            if !in_time(op.timestamp.as_deref(), &scope, tz)
                || scope.thread_id.as_ref().is_some_and(|t| t != &thread.id)
            {
                continue;
            }
            let candidates = if op.name == "read_file" {
                let path = op.path.as_ref().and_then(|p| {
                    let path = PathBuf::from(p);
                    if path.is_absolute() {
                        crate::absolute(path).ok()
                    } else {
                        thread
                            .project
                            .as_ref()
                            .and_then(|base| crate::absolute(PathBuf::from(base).join(path)).ok())
                    }
                });
                path.and_then(|p| {
                    paths.get(&(
                        thread.source_instance_id.clone(),
                        p.to_string_lossy().into_owned(),
                    ))
                })
            } else if op.kind == "mcp" && !op.name.starts_with("mcp__") {
                op.server
                    .as_ref()
                    .and_then(|s| servers.get(&(thread.source_instance_id.clone(), s.clone())))
            } else {
                None
            };
            let Some(candidates) = candidates else {
                continue;
            };
            let candidates = candidates
                .iter()
                .copied()
                .filter(|n| {
                    items[*n]
                        .project
                        .as_ref()
                        .is_none_or(|p| thread.project.as_ref() == Some(p))
                })
                .collect::<Vec<_>>();
            if candidates.len() != 1 {
                continue;
            }
            let n = candidates[0];
            let item = &mut items[n];
            let full_scope = Scope {
                project: None,
                ..scope.clone()
            };
            let indices = op
                .turn_id
                .as_deref()
                .and_then(|u| turns.get(&(thread.id.as_str(), u)))
                .into_iter()
                .flatten()
                .copied()
                .filter(|i| matches_row(ledger[*i], &full_scope, tz, &projects))
                .collect::<BTreeSet<_>>();
            if r.item_id.as_ref() == Some(&item.id) {
                let entry = related.entry(thread.project.clone()).or_default();
                entry.0 += 1;
                entry.1.extend(&indices);
            }
            if scope
                .project
                .as_ref()
                .is_some_and(|p| thread.project.as_ref() != Some(p))
            {
                continue;
            }
            let typ = if item.kind == Kind::Mcp {
                item.counts.tool_calls += 1;
                item.observation = Observation::Used;
                "tool_call"
            } else {
                item.counts.file_reads += 1;
                if op.status == "completed" {
                    item.observation = Observation::LoadedOnly;
                }
                "file_read"
            };
            match op.status.as_str() {
                "completed" => item.counts.succeeded += 1,
                "failed" => item.counts.failed += 1,
                _ => item.counts.outcome_unknown += 1,
            };
            item_rows[n].extend(&indices);
            if let Some(u) = &op.turn_id {
                item_turns[n].insert(format!("{}:{u}", thread.id));
            }
            if r.item_id.as_ref() == Some(&item.id) {
                evidence.push(Evidence {
                    id: op.id.clone(),
                    item_id: item.id.clone(),
                    thread_id: thread.id.clone(),
                    turn_id: op.turn_id.clone(),
                    title: thread.title.clone(),
                    project: thread.project.clone(),
                    timestamp: op.timestamp.clone(),
                    event_type: typ.into(),
                    outcome: op.status.clone(),
                    association: "identityOnlyVersionUnknown".into(),
                    usage: usage(&indices.iter().map(|i| ledger[*i]).collect::<Vec<_>>())?,
                });
            }
        }
        let mut union = BTreeSet::<usize>::new();
        for (n, item) in items.iter_mut().enumerate() {
            item.related_turns = item_turns[n].len();
            item.usage = usage(&item_rows[n].iter().map(|i| ledger[*i]).collect::<Vec<_>>())?;
            union.extend(item_rows[n].iter().copied());
        }
        result.summary.usage = usage(&union.into_iter().map(|i| ledger[i]).collect::<Vec<_>>())?;
        result.related_scopes = related
            .into_iter()
            .map(|(project, (evidence_count, ids))| {
                Ok(RelatedScope {
                    project,
                    evidence_count,
                    usage: usage(&ids.into_iter().map(|i| ledger[i]).collect::<Vec<_>>())?,
                })
            })
            .collect::<Result<_>>()?;
    }
    if scope.thread_id.is_some() {
        items.retain(|i| i.counts.file_reads + i.counts.tool_calls > 0);
    }
    result.summary.current_items = items.iter().filter(|i| i.current).count();
    result.summary.historical_items = items.iter().filter(|i| !i.current).count();
    result.summary.observed_items = items
        .iter()
        .filter(|i| i.observation == Observation::Used)
        .count();
    items.retain(|i| {
        r.kind.as_ref().is_none_or(|k| k == &i.kind)
            && r.observation.as_ref().is_none_or(|v| v == &i.observation)
            && r.search.as_ref().is_none_or(|q| {
                format!("{} {}", i.name, i.path)
                    .to_lowercase()
                    .contains(&q.to_lowercase())
            })
    });
    items.sort_by(|a, b| {
        let order = match r.sort {
            Sort::Tokens => b
                .usage
                .as_ref()
                .and_then(|v| v.tokens.total)
                .cmp(&a.usage.as_ref().and_then(|v| v.tokens.total)),
            Sort::Activity => (b.counts.tool_calls + b.counts.file_reads)
                .cmp(&(a.counts.tool_calls + a.counts.file_reads)),
            Sort::Size => b.bytes.cmp(&a.bytes),
            Sort::Name => a.name.cmp(&b.name),
        };
        order.then(a.id.cmp(&b.id))
    });
    let offset = r.offset.unwrap_or(0);
    let limit = r.limit.unwrap_or(50);
    if r.action != Action::List {
        items.retain(|i| Some(&i.id) == r.item_id.as_ref());
        if items.is_empty() {
            return Err(operation_error("NOT_FOUND", "未找到配置"));
        }
    }
    evidence.sort_by(|a, b| (&a.timestamp, &a.id).cmp(&(&b.timestamp, &b.id)));
    let total = if r.action == Action::Evidence {
        evidence.len()
    } else if r.action == Action::RelatedScopes {
        result.related_scopes.len()
    } else {
        items.len()
    };
    result.page = crate::usage_app_dto::Page {
        offset,
        limit,
        total,
        next_offset: (offset.saturating_add(limit) < total).then_some(offset.saturating_add(limit)),
    };
    result.items = if r.action == Action::List {
        items.into_iter().skip(offset).take(limit).collect()
    } else {
        items
    };
    result.evidence = if r.action == Action::Evidence {
        evidence.into_iter().skip(offset).take(limit).collect()
    } else {
        vec![]
    };
    if r.action != Action::RelatedScopes {
        result.related_scopes.clear();
    } else {
        result.related_scopes = result
            .related_scopes
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view() -> View {
        View {
            snapshot: None,
            items: vec![],
            issues: vec![],
            projects: vec![],
            roots: vec![],
            project_roots: vec![],
            revision: "one".into(),
            checked: "now".into(),
            history_status: "unavailable".into(),
        }
    }
    #[test]
    fn views_expire_explicitly_and_store_is_bounded() {
        let mut store = Store::default();
        let (first, _) = store.insert(view());
        for _ in 0..8 {
            store.insert(view());
        }
        assert_eq!(store.views.len(), 8);
        assert!(store.get(&first).is_err());
        let (last, _) = store.insert(view());
        store.views.back_mut().unwrap().1 = Instant::now() - Duration::from_secs(601);
        assert!(store.get(&last).is_err());
        for (_, at, _) in &mut store.views {
            *at = Instant::now() - Duration::from_secs(601);
        }
        assert!(!store.has_views());
    }
    #[test]
    fn local_dates_use_exclusive_end_and_preserve_unknowns() {
        let (scope, tz) = normalize(&Scope {
            since: Some("2026-09-29".into()),
            until: Some("2026-09-30".into()),
            timezone: Some("Asia/Shanghai".into()),
            ..Default::default()
        })
        .unwrap();
        assert!(in_time(Some("2026-09-28T16:00:00Z"), &scope, tz));
        assert!(!in_time(Some("2026-09-29T16:00:00Z"), &scope, tz));
        assert!(!in_time(None, &scope, tz));
        let result = execute(Request::default(), "view".into(), &view()).unwrap();
        assert!(result.summary.usage.is_none());
        assert!(!result.coverage.absence_observable);
        assert_eq!(result.coverage.status, "partial");
    }
}
