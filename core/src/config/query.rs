//! Inventory lists, usage summaries, evidence and related scopes from one pinned view.
use super::*;
use crate::usage_observations::{self, Projection, TimeBasis};
pub(crate) fn execute(r: Request, id: String, view: &View) -> Result<Response> {
    validate(&r)?;
    let (scope, tz) = normalize_at(&r.scope, &view.checked)?;
    let mut result = capabilities();
    result.hook_registry = view.hook_registry.clone();
    result
        .hook_registry
        .contexts
        .retain(|c| scope.project.as_ref().is_none_or(|p| p == &c.project));
    result.action = r.action.clone();
    result.scope = scope.clone();
    result.checked_at = view.checked.clone();
    result.read_view = Some(id);
    result.config_revision = view.revision.clone();
    result.authorized_projects = view.projects.clone();
    result.authorized_source_roots = view.roots.clone();
    result.usage_revision = view
        .snapshot
        .as_ref()
        .map(|s| s.manifest.snapshot_ref.snapshot_id.clone());
    result.coverage.history_status = if view.snapshot.as_ref().is_some_and(|s| {
        s.manifest
            .issues
            .iter()
            .any(|issue| issue.code == crate::adapters::codex::preview::ISSUE)
    }) {
        "syncing".into()
    } else if view.snapshot.as_ref().is_some_and(|s| {
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
    // Cached inventory metadata cannot carry a prior query's historical use state.
    for item in &mut items {
        item.usage_count = None;
        item.counts = Counts::default();
        item.observation = Observation::Unknown;
        item.last_record_at = None;
        item.related_turns = 0;
        item.related_tasks = 0;
        item.usage = None;
        for context in &mut item.source_contexts {
            context.counts = Counts::default();
            context.observation = Observation::Unknown;
            context.last_record_at = None;
        }
    }
    let mut evidence = vec![];
    let mut uncertain_items = BTreeSet::new();
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
            for source in item.source_ids() {
                if item.kind == Kind::Mcp {
                    servers
                        .entry((
                            source.to_owned(),
                            item.native_key.clone().unwrap_or_default(),
                        ))
                        .or_default()
                        .push(n);
                } else {
                    paths
                        .entry((source.to_owned(), item.path.clone()))
                        .or_default()
                        .push(n);
                }
            }
        }
        // Availability is a current host observation, independent of the history date window.
        // Use only the newest catalog in the selected project for each source.
        let mut latest_catalogs =
            BTreeMap::<String, ((Option<String>, u64, String), String)>::new();
        for op in snapshot.operation_facts() {
            if op.kind.as_ref() != "skillCatalog" {
                continue;
            }
            let Some(thread) = threads.get(op.thread_id.as_ref()) else {
                continue;
            };
            if scope
                .source_instance_id
                .as_ref()
                .is_some_and(|id| id != &thread.source_instance_id)
                || scope
                    .project
                    .as_ref()
                    .is_some_and(|project| thread.project.as_ref() != Some(project))
            {
                continue;
            }
            let order = (op.timestamp.clone(), op.sequence, op.id.clone());
            let occurrence = catalog_occurrence(op);
            latest_catalogs
                .entry(thread.source_instance_id.clone())
                .and_modify(|current| {
                    if order > current.0 {
                        *current = (order.clone(), occurrence.clone());
                    }
                })
                .or_insert((order, occurrence));
        }
        for op in snapshot.operation_facts() {
            if op.kind.as_ref() != "skillAvailable" {
                continue;
            }
            let Some(thread) = threads.get(op.thread_id.as_ref()) else {
                continue;
            };
            if latest_catalogs
                .get(&thread.source_instance_id)
                .is_none_or(|(_, latest)| latest != &catalog_occurrence(op))
            {
                continue;
            }
            let Some(path) =
                normalized_operation_path(op.path.as_deref(), thread.project.as_deref())
            else {
                continue;
            };
            let Some(candidates) = paths.get(&(thread.source_instance_id.clone(), path)) else {
                continue;
            };
            for index in candidates {
                if items[*index].kind != Kind::Skill {
                    continue;
                }
                items[*index].configured_state = "enabled".into();
                if let Some(context) = items[*index]
                    .source_contexts
                    .iter_mut()
                    .find(|context| context.source_instance_id == thread.source_instance_id)
                {
                    context.configured_state = "enabled".into();
                }
            }
        }
        let mut item_rows = vec![BTreeSet::<usize>::new(); items.len()];
        let mut item_turns = vec![BTreeSet::<String>::new(); items.len()];
        let mut item_tasks = vec![BTreeSet::<String>::new(); items.len()];
        let mut item_uses = (0..items.len())
            .map(|_| Projection::default())
            .collect::<Vec<_>>();
        let mut unassigned_sources = BTreeSet::<String>::new();
        let mut unassigned_skill_sources = BTreeSet::<String>::new();
        let conflicts = usage_observations::target_conflicts(
            || snapshot.operation_facts().map(AsRef::as_ref),
            |op| {
                threads
                    .get(op.thread_id.as_ref())
                    .and_then(|thread| thread.project.as_deref())
            },
            |op| {
                let Some(thread) = threads.get(op.thread_id.as_ref()) else {
                    return false;
                };
                if scope
                    .source_instance_id
                    .as_ref()
                    .is_some_and(|id| id != &thread.source_instance_id)
                    || scope.thread_id.as_ref().is_some_and(|id| id != &thread.id)
                {
                    return false;
                }
                if let Some(reads) = usage_observations::read_targets(op) {
                    (reads.unbound && !paths.is_empty())
                        || reads.paths.iter().any(|raw| {
                            reads
                                .resolve(raw, thread.project.as_deref())
                                .is_some_and(|path| {
                                    paths.contains_key(&(thread.source_instance_id.clone(), path))
                                })
                        })
                } else {
                    op.server.as_ref().is_some_and(|server| {
                        servers
                            .contains_key(&(thread.source_instance_id.clone(), server.to_string()))
                    })
                }
            },
        );
        let mut seen = BTreeSet::new();
        for op in snapshot.operation_facts() {
            let Some(thread) = threads.get(op.thread_id.as_ref()) else {
                continue;
            };
            if scope
                .source_instance_id
                .as_ref()
                .is_some_and(|id| id != &thread.source_instance_id)
                || scope.thread_id.as_ref().is_some_and(|t| t != &thread.id)
            {
                continue;
            }
            let instruction_load = op.kind.as_ref() == "instructionLoad";
            let skill_available = op.kind.as_ref() == "skillAvailable";
            let use_kind = usage_observations::use_kind(op);
            let candidate_read = usage_observations::is_skill_read_candidate(op);
            let reads = usage_observations::read_targets(op);
            let file_read = instruction_load
                || op.kind.as_ref() == "skillRead"
                || (op.name.as_ref() == "read_file"
                    && matches!(op.kind.as_ref(), "tool" | "skillRead"));
            if matches!(op.kind.as_ref(), "mcpConflict" | "mcpUnclassified") {
                if scope
                    .project
                    .as_ref()
                    .is_none_or(|p| thread.project.as_ref() == Some(p))
                    && (in_time(op.timestamp.as_deref(), &scope, tz)
                        || usage_observations::time_basis(op) == TimeBasis::Unknown)
                {
                    unassigned_sources.insert(thread.source_instance_id.clone());
                }
                continue;
            }
            let mut read_paths = BTreeSet::new();
            let mut unbound_read = false;
            if let Some(reads) = &reads {
                unbound_read = reads.unbound && (use_kind.is_some() || candidate_read);
                for raw in &reads.paths {
                    if let Some(path) = reads.resolve(raw, thread.project.as_deref()) {
                        read_paths.insert(path);
                    } else if usage_observations::is_skill_file(raw) {
                        unbound_read = true;
                    }
                }
            }
            if unbound_read
                && (in_time(op.timestamp.as_deref(), &scope, tz)
                    || usage_observations::time_basis(op) == TimeBasis::Unknown)
                && scope
                    .project
                    .as_ref()
                    .is_none_or(|p| thread.project.as_ref() == Some(p))
            {
                unassigned_skill_sources.insert(thread.source_instance_id.clone());
            }
            if read_paths.is_empty() {
                read_paths.insert(String::new());
            }
            for read_path in &read_paths {
                let candidates = if reads.is_some() {
                    paths.get(&(thread.source_instance_id.clone(), read_path.clone()))
                } else if file_read || skill_available {
                    normalized_operation_path(op.path.as_deref(), thread.project.as_deref())
                        .and_then(|path| paths.get(&(thread.source_instance_id.clone(), path)))
                } else if matches!(op.kind.as_ref(), "mcpTool" | "mcpResource") {
                    op.server.as_ref().and_then(|s| {
                        servers.get(&(thread.source_instance_id.clone(), s.to_string()))
                    })
                } else {
                    None
                };
                let Some(candidates) = candidates else {
                    if (use_kind.is_some() || candidate_read)
                        && (in_time(op.timestamp.as_deref(), &scope, tz)
                            || usage_observations::time_basis(op) == TimeBasis::Unknown)
                        && scope
                            .project
                            .as_ref()
                            .is_none_or(|p| thread.project.as_ref() == Some(p))
                    {
                        if matches!(op.kind.as_ref(), "mcpTool" | "mcpResource")
                            && op.server.is_none()
                        {
                            unassigned_sources.insert(thread.source_instance_id.clone());
                        } else if file_read
                            && normalized_operation_path(
                                op.path.as_deref(),
                                thread.project.as_deref(),
                            )
                            .is_none()
                        {
                            unassigned_skill_sources.insert(thread.source_instance_id.clone());
                        }
                        result.coverage.issues.push(Issue {
                            code: "usageOperationTargetUnknown".into(),
                            path: None,
                        });
                    }
                    continue;
                };
                let candidates = candidates
                    .iter()
                    .copied()
                    .filter(|n| {
                        file_read
                            || skill_available
                            || items[*n]
                                .project
                                .as_ref()
                                .is_none_or(|p| thread.project.as_ref() == Some(p))
                    })
                    .collect::<Vec<_>>();
                if candidates.len() != 1 {
                    if (use_kind.is_some() || candidate_read)
                        && scope
                            .project
                            .as_ref()
                            .is_none_or(|p| thread.project.as_ref() == Some(p))
                        && (in_time(op.timestamp.as_deref(), &scope, tz)
                            || usage_observations::time_basis(op) == TimeBasis::Unknown)
                    {
                        for index in candidates {
                            item_uses[index].coverage.target_gaps += 1;
                        }
                    }
                    continue;
                }
                let n = candidates[0];
                if usage_observations::time_basis(op) == TimeBasis::Unknown {
                    item_uses[n].note_time_gap(op);
                }
                if let Some(identity) = usage_observations::operation_identity(op)
                    && !seen.insert((identity, n))
                {
                    continue;
                }
                if !in_time(op.timestamp.as_deref(), &scope, tz) {
                    continue;
                }
                if usage_observations::operation_identity(op)
                    .is_some_and(|identity| conflicts.contains(&identity))
                {
                    item_uses[n].coverage.target_gaps += 1;
                }
                let item = &mut items[n];
                if reads.as_ref().is_some_and(|reads| reads.candidate) {
                    if scope
                        .project
                        .as_ref()
                        .is_none_or(|p| thread.project.as_ref() == Some(p))
                    {
                        item_uses[n].coverage.dispatch_gaps += 1;
                        if item.kind == Kind::Rule {
                            result.coverage.issues.push(Issue {
                                code: "ruleReadDispatchUnknown".into(),
                                path: Some(item.path.clone()),
                            });
                        }
                        if r.item_id.as_ref() == Some(&item.id) {
                            evidence.push(Evidence {
                                id: op.id.clone(),
                                source_instance_id: Some(thread.source_instance_id.clone()),
                                item_id: item.id.clone(),
                                thread_id: thread.id.clone(),
                                turn_id: op.turn_id.as_deref().map(str::to_owned),
                                title: thread.title.clone(),
                                project: thread.project.clone(),
                                timestamp: op.timestamp.clone(),
                                event_type: if item.kind == Kind::Rule {
                                    "rule_read_candidate"
                                } else {
                                    "skill_read_candidate"
                                }
                                .into(),
                                outcome: "unknown".into(),
                                association: "operationDispatchUnknown".into(),
                                usage: None,
                            });
                        }
                    }
                    continue;
                }
                if skill_available {
                    if r.item_id.as_ref() == Some(&item.id) {
                        evidence.push(Evidence {
                            id: op.id.clone(),
                            source_instance_id: Some(thread.source_instance_id.clone()),
                            item_id: item.id.clone(),
                            thread_id: thread.id.clone(),
                            turn_id: op.turn_id.as_deref().map(str::to_owned),
                            title: thread.title.clone(),
                            project: thread.project.clone(),
                            timestamp: op.timestamp.clone(),
                            event_type: "skill_available".into(),
                            outcome: "observed".into(),
                            association: "hostAvailability".into(),
                            usage: None,
                        });
                    }
                    continue;
                }
                let observed_use =
                    use_kind.is_some() && matches!(item.kind, Kind::Skill | Kind::Mcp);
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
                if op.timestamp > item.last_record_at {
                    item.last_record_at = op.timestamp.clone();
                }
                let typ = if item.kind == Kind::Mcp {
                    if op.kind.as_ref() == "mcpResource" {
                        item.counts.resource_reads += 1;
                    } else {
                        item.counts.tool_calls += 1;
                    }
                    item.observation = Observation::Used;
                    if op.kind.as_ref() == "mcpResource" {
                        "resource_read"
                    } else {
                        "tool_call"
                    }
                } else if item.kind == Kind::Skill {
                    if file_read {
                        item.counts.file_reads += 1;
                    }
                    if observed_use {
                        item.observation = Observation::Used;
                    }
                    "file_read"
                } else {
                    item.counts.file_reads += 1;
                    if op.status.as_ref() == "completed" {
                        item.observation = Observation::LoadedOnly;
                    }
                    if instruction_load {
                        "instruction_load"
                    } else {
                        "file_read"
                    }
                };
                match op.status.as_ref() {
                    "completed" => item.counts.succeeded += 1,
                    "failed" => item.counts.failed += 1,
                    _ => item.counts.outcome_unknown += 1,
                };
                if let Some(context) = item
                    .source_contexts
                    .iter_mut()
                    .find(|c| c.source_instance_id == thread.source_instance_id)
                {
                    if op.timestamp > context.last_record_at {
                        context.last_record_at = op.timestamp.clone();
                    }
                    if item.kind == Kind::Mcp {
                        if op.kind.as_ref() == "mcpResource" {
                            context.counts.resource_reads += 1;
                        } else {
                            context.counts.tool_calls += 1;
                        }
                        context.observation = Observation::Used;
                    } else if item.kind == Kind::Skill {
                        if file_read {
                            context.counts.file_reads += 1;
                        }
                        if observed_use {
                            context.observation = Observation::Used;
                        }
                    } else {
                        context.counts.file_reads += 1;
                        if op.status.as_ref() == "completed" {
                            context.observation = Observation::LoadedOnly;
                        }
                    }
                    match op.status.as_ref() {
                        "completed" => context.counts.succeeded += 1,
                        "failed" => context.counts.failed += 1,
                        _ => context.counts.outcome_unknown += 1,
                    }
                }
                item_rows[n].extend(&indices);
                item_tasks[n].insert(thread.id.clone());
                if observed_use {
                    item_uses[n].observe_with_time_accounted(op);
                }
                if let Some(u) = &op.turn_id {
                    item_turns[n].insert(format!("{}:{u}", thread.id));
                }
                if r.item_id.as_ref() == Some(&item.id) {
                    evidence.push(Evidence {
                        id: op.id.clone(),
                        source_instance_id: Some(thread.source_instance_id.clone()),
                        item_id: item.id.clone(),
                        thread_id: thread.id.clone(),
                        turn_id: op.turn_id.as_deref().map(str::to_owned),
                        title: thread.title.clone(),
                        project: thread.project.clone(),
                        timestamp: op.timestamp.clone(),
                        event_type: typ.into(),
                        outcome: op.status.to_string(),
                        association: "identityOnlyVersionUnknown".into(),
                        usage: usage(&indices.iter().map(|i| ledger[*i]).collect::<Vec<_>>())?,
                    });
                }
            }
        }
        let mut union = BTreeSet::<usize>::new();
        for (n, item) in items.iter_mut().enumerate() {
            item.related_turns = item_turns[n].len();
            item.related_tasks = item_tasks[n].len();
            if matches!(item.kind, Kind::Skill | Kind::Mcp) {
                let projection = &mut item_uses[n];
                if item.kind == Kind::Mcp
                    && item
                        .source_ids()
                        .any(|source| unassigned_sources.contains(source))
                {
                    projection.coverage.target_gaps += 1;
                }
                if item.kind == Kind::Skill
                    && item
                        .source_ids()
                        .any(|source| unassigned_skill_sources.contains(source))
                {
                    projection.coverage.target_gaps += 1;
                }
                item.usage_count = projection
                    .count(scope.all_time != Some(true))
                    .filter(|count| *count > 0);
                item.related_turns = projection.related_turns();
                item.related_tasks = projection.related_tasks();
                for (gap, code) in [
                    (projection.coverage.dispatch_gaps, "DispatchUnknown"),
                    (projection.coverage.identity_gaps, "IdentityUnknown"),
                    (projection.coverage.target_gaps, "TargetUnknown"),
                    (projection.coverage.time_gaps, "TimeUnknown"),
                    (projection.coverage.turn_gaps, "TurnUnknown"),
                ] {
                    if gap > 0 {
                        uncertain_items.insert(item.id.clone());
                        result.coverage.issues.push(Issue {
                            code: format!(
                                "usageCountV{}{code}",
                                usage_observations::METHOD_VERSION
                            ),
                            path: Some(item.path.clone()),
                        });
                    }
                }
            }
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
        items.retain(|i| {
            i.counts.file_reads + i.counts.tool_calls + i.counts.resource_reads > 0
                || i.usage_count.unwrap_or(0) > 0
                || uncertain_items.contains(&i.id)
        });
    }
    result.summary.current_items = items
        .iter()
        .filter(|i| i.current && i.configured_state != "missing")
        .count();
    result.summary.historical_items = items.iter().filter(|i| !i.current).count();
    result.summary.observed_items = items
        .iter()
        .filter(|i| i.observation == Observation::Used)
        .count();
    items.retain(|i| {
        r.kind.as_ref().is_none_or(|k| k == &i.kind)
            && r.kinds.as_ref().is_none_or(|kinds| kinds.contains(&i.kind))
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
            Sort::Activity => b.usage_count.cmp(&a.usage_count),
            Sort::Size => b.bytes.cmp(&a.bytes),
            Sort::Name => a.name.cmp(&b.name),
            Sort::ContentTokens => b.content_tokens.cmp(&a.content_tokens),
            Sort::Characters => b.characters.cmp(&a.characters),
            Sort::Recent => b.last_record_at.cmp(&a.last_record_at),
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

fn catalog_occurrence(operation: &crate::adapters::contract::Operation) -> String {
    format!(
        "{}:{}:{}:{}",
        operation.thread_id,
        operation.turn_id.as_deref().unwrap_or(""),
        operation.sequence,
        operation.response_id.as_deref().unwrap_or("")
    )
}

fn normalized_operation_path(path: Option<&str>, project: Option<&str>) -> Option<String> {
    usage_observations::normalized_path(path?, project)
}
