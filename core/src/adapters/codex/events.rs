//! Source event mapping retains native request, context, tool and usage evidence.
use super::*;
#[allow(clippy::too_many_arguments)]
pub(super) fn process(
    kind: &str,
    p: Payload<'_>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &mut State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    if kind == "session_meta" {
        if let Some(version) = p.cli_version.as_deref() {
            let version = safe_text(version);
            if !report.source_versions.contains(&version) {
                report.source_versions.push(version);
            }
        }
        if let Some(upstream) = p.id.as_deref().or(p.session_id.as_deref()) {
            state.break_context();
            state.uncertain_counter = false;
            let thread = facts.thread(source, upstream, time.as_deref(), p.cwd.as_deref());
            if let Some(parent) = p.forked_from_id.as_deref() {
                let parent = stable_id(&["codex", &source.id, "thread", parent]);
                facts.parents.insert(thread.clone(), parent);
            }
            state.thread = Some(thread);
        }
        return;
    }
    let event = if kind == "event_msg" {
        p.kind.as_deref().unwrap_or("")
    } else {
        kind
    };
    let owner = p
        .thread_id
        .as_deref()
        .map(|upstream| facts.thread(source, upstream, time.as_deref(), None))
        .or_else(|| state.thread.clone());
    if let Some(thread) = &owner
        && let Some(t) = facts.threads.get_mut(thread)
        && time
            .as_ref()
            .is_some_and(|new| t.last_activity_at.as_ref().is_none_or(|old| new > old))
    {
        t.last_activity_at = time.clone();
    }
    let explicit_turn = owner
        .as_ref()
        .zip(p.turn_id.as_deref().filter(|id| !id.is_empty()))
        .map(|(thread, turn)| facts.turn(thread, turn, time.as_deref(), None));
    let decoded_item = match p.item {
        Some(raw) => match serde_json::from_str::<Payload>(raw.get()) {
            Ok(item) => Some(item),
            Err(_) => {
                issue(
                    report,
                    "invalidOperation",
                    "操作记录格式无效",
                    Some(evidence),
                );
                return;
            }
        },
        _ => None,
    };
    let item = decoded_item.as_ref().unwrap_or(&p);
    timing::observe(
        &p,
        item,
        event,
        owner.as_deref(),
        explicit_turn.as_deref().or_else(|| {
            (event != "task_started" && owner == state.thread)
                .then_some(state.turn.as_deref())
                .flatten()
        }),
        facts,
        report,
        &evidence,
    );
    if kind == "response_item"
        && let Some(loads) = instructions::loads(&p)
        && let Some(thread) = &owner
    {
        let turn = loads
            .turn_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .map(|id| facts.turn(thread, id, time.as_deref(), None))
            .or(explicit_turn.clone());
        for path in loads.paths {
            let identity = stable_id(&[
                p.id.as_deref().unwrap_or(&fingerprint),
                "instructionLoad",
                &path,
            ]);
            let mut operation = empty_operation(
                thread,
                turn.clone(),
                time.clone(),
                raw_time,
                &evidence,
                "instructionLoad",
                "agents_instructions",
                &identity,
            );
            operation.status = "completed".into();
            operation.path = Some(path);
            facts.operation(operation, report);
        }
        return;
    }
    if kind == "response_item"
        && let Some(availability) = skills::availability(&p)
        && let Some(thread) = &owner
    {
        let turn = availability
            .turn_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .map(|id| facts.turn(thread, id, time.as_deref(), None))
            .or(explicit_turn.clone());
        let catalog_identity =
            stable_id(&[p.id.as_deref().unwrap_or(&fingerprint), "skillCatalog"]);
        let mut catalog = empty_operation(
            thread,
            turn.clone(),
            time.clone(),
            raw_time,
            &evidence,
            "skillCatalog",
            "host_skills",
            &catalog_identity,
        );
        catalog.status = "completed".into();
        catalog.response_id = Some(availability.catalog_id.clone());
        facts.operation(catalog, report);
        state.available_skills = availability
            .entries
            .iter()
            .map(|entry| (entry.name.clone(), entry.path.clone()))
            .collect();
        for entry in availability.entries {
            let identity = stable_id(&[
                p.id.as_deref().unwrap_or(&fingerprint),
                "skillAvailable",
                &entry.path,
            ]);
            let mut operation = empty_operation(
                thread,
                turn.clone(),
                time.clone(),
                raw_time,
                &evidence,
                "skillAvailable",
                &entry.name,
                &identity,
            );
            operation.status = "completed".into();
            operation.response_id = Some(availability.catalog_id.clone());
            operation.path = Some(entry.path);
            facts.operation(operation, report);
        }
        return;
    }
    if kind == "response_item"
        && !state.turn_had_operation
        && let Some(thread) = &owner
    {
        let turn = explicit_turn.clone().or_else(|| state.turn.clone());
        for entry in skills::declarations(&p, &state.available_skills) {
            let identity = stable_id(&["skillUse", &entry.path]);
            let mut operation = empty_operation(
                thread,
                turn.clone(),
                time.clone(),
                raw_time,
                &evidence,
                "skillUse",
                &entry.name,
                &identity,
            );
            operation.status = "completed".into();
            operation.path = Some(entry.path);
            facts.operation(operation, report);
        }
    }
    if matches!(event, "turn_context" | "thread_settings_applied") {
        if let Some(upstream) = owner
            .as_ref()
            .and_then(|id| facts.threads.get(id))
            .map(|t| t.upstream_id.clone())
        {
            facts.thread(source, &upstream, time.as_deref(), p.cwd.as_deref());
        }
        if owner != state.thread {
            state.break_context();
            state.thread = owner.clone();
        }
        if let Some(turn) = explicit_turn {
            state.turn = Some(turn);
        }
        let (model, effort, conflict) = context_fields(&p);
        state.model = model;
        state.effort = effort;
        if event == "thread_settings_applied" {
            state.thread_model = state.model.clone();
            state.thread_effort = state.effort.clone();
        }
        if conflict {
            issue(
                report,
                "contextConflict",
                "历史模型或推理强度设置冲突",
                Some(evidence),
            );
        }
        return;
    }
    if matches!(
        event,
        "task_started" | "task_complete" | "turn_aborted" | "turn_failed"
    ) {
        let status = match event {
            "task_started" => "running",
            "task_complete" => "completed",
            "turn_failed" => "failed",
            _ => "interrupted",
        };
        if let (Some(thread), Some(upstream)) = (&owner, p.turn_id.as_deref()) {
            let new_turn = facts.turn(thread, upstream, time.as_deref(), Some(status));
            if event == "task_started" && state.turn.as_deref() != Some(&new_turn) {
                state.model = state.thread_model.clone();
                state.effort = state.thread_effort.clone();
            }
            state.turn = Some(new_turn);
            if event == "task_started" {
                state.turn_had_operation = false;
            }
        }
        if event != "task_started" {
            state.turn = None;
            state.model = state.thread_model.clone();
            state.effort = state.thread_effort.clone();
        }
        return;
    }
    let same_owner = owner == state.thread;
    let turn = explicit_turn.or_else(|| same_owner.then(|| state.turn.clone()).flatten());
    if kind == "response_item"
        && p.status.as_deref() == Some("completed")
        && let Some(thread) = &owner
    {
        for path in skills::exec_reads(&p) {
            let identity = stable_id(&[
                p.call_id.as_deref().unwrap_or(&fingerprint),
                "skillRead",
                &path,
            ]);
            let mut operation = empty_operation(
                thread,
                turn.clone(),
                time.clone(),
                raw_time,
                &evidence,
                "skillRead",
                "read_skill_file",
                &identity,
            );
            operation.status = "completed".into();
            operation.path = Some(path);
            facts.operation(operation, report);
        }
    }
    if kind == "response_item"
        && matches!(
            p.kind.as_deref(),
            Some("function_call" | "custom_tool_call")
        )
    {
        state.turn_had_operation = true;
    }
    if event == "token_usage_record" {
        direct_measurement(
            &p,
            owner,
            turn,
            time,
            raw_time,
            evidence,
            fingerprint,
            state,
            facts,
            source,
            report,
        );
    } else if event == "token_count" {
        legacy_measurement(
            &p,
            owner,
            turn,
            time,
            raw_time,
            evidence,
            fingerprint,
            state,
            facts,
            source,
            report,
        );
    } else if event == "compacted" {
        if let Some(raw) = p.latest_token_usage_record
            && let Ok(latest) = serde_json::from_str::<Payload>(raw.get())
        {
            let latest_owner = latest
                .thread_id
                .as_deref()
                .map(|id| facts.thread(source, id, time.as_deref(), None))
                .or(owner.clone());
            let latest_turn = latest_owner
                .as_ref()
                .zip(latest.turn_id.as_deref())
                .map(|(t, id)| facts.turn(t, id, time.as_deref(), None));
            direct_measurement(
                &latest,
                latest_owner,
                latest_turn,
                time.clone(),
                raw_time,
                evidence.clone(),
                fingerprint.clone(),
                state,
                facts,
                source,
                report,
            );
        }
        if let Some(thread) = owner {
            let identity = p.compaction_response_id.as_deref().unwrap_or(&fingerprint);
            let mut op = empty_operation(
                &thread,
                turn,
                time,
                raw_time,
                &evidence,
                "compaction",
                "上下文压缩",
                identity,
            );
            op.response_id = p.compaction_response_id;
            op.status = "completed".into();
            facts.operation(op, report);
        }
    } else if matches!(event, "mcp_tool_call_begin" | "mcp_tool_call_end")
        && let Some(thread) = owner
    {
        operations::mcp_event(
            &p, event, &thread, turn, time, raw_time, evidence, facts, report,
        );
    } else if (kind == "response_item" || matches!(event, "item_completed" | "item_started"))
        && let Some(thread) = owner
    {
        operation(
            &p,
            item,
            event,
            &thread,
            turn,
            time,
            raw_time,
            evidence,
            &fingerprint,
            facts,
            report,
        );
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn direct_measurement(
    p: &Payload<'_>,
    owner: Option<String>,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    let Some(raw) = p.usage else {
        issue(report, "missingUsage", "逐响应记录缺少用量", Some(evidence));
        return;
    };
    let Some(tokens) = parse_tokens(raw, report, &evidence) else {
        return;
    };
    let response = p.response_id.as_deref();
    let id = if let Some(response) = response {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "response",
            response,
        ])
    } else {
        issue(
            report,
            "missingResponseIdentity",
            "用量记录缺少响应身份",
            Some(evidence.clone()),
        );
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "record",
            &evidence.file,
            &evidence.line.to_string(),
        ])
    };
    let cumulative = p
        .thread_token_usage
        .and_then(|raw| serde_json::from_str::<Counts>(raw.get()).ok())
        .and_then(|c| c.total_tokens);
    let interval_start = cumulative
        .zip(tokens.total)
        .and_then(|(a, b)| a.checked_sub(b));
    let (model, effort) = measurement_context(
        p,
        state,
        owner.as_ref() == state.thread.as_ref(),
        turn.as_deref(),
    );
    facts.measurement(
        Candidate {
            measurement: Measurement {
                id,
                agent_kind: "codex".into(),
                source_instance_id: source.id.as_str().into(),
                thread_id: owner.map(Into::into),
                turn_id: turn.map(Into::into),
                response_id: response.map(str::to_owned),
                timestamp: time,
                interval_end: None,
                grain: "response".into(),
                time_precision: precision(raw_time).into(),
                model,
                reasoning_effort: effort.map(Into::into),
                tokens,
                request_scoped: true,
                reported_cost: reported_cost(p.cost),
                service_tier: p.service_tier.as_deref().map(safe_text),
                sequence: evidence.line,
                evidence: vec![evidence],
            }
            .into(),
            direct: true,
            cumulative,
            interval_start,
            fingerprint,
        },
        report,
    );
}

#[allow(clippy::too_many_arguments)]
pub(super) fn legacy_measurement(
    p: &Payload<'_>,
    owner: Option<String>,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &mut State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    let Some(info) = p
        .info
        .and_then(|raw| serde_json::from_str::<UsageInfo>(raw.get()).ok())
    else {
        return;
    };
    let total = info
        .total_token_usage
        .and_then(|raw| parse_legacy_tokens(raw, report, &evidence));
    let last = info
        .last_token_usage
        .and_then(|raw| parse_legacy_tokens(raw, report, &evidence));
    if total.is_none() && last.is_none() {
        return;
    }
    let previous_total = state.previous.as_ref().and_then(|v| v.total).unwrap_or(0);
    if total
        .as_ref()
        .is_some_and(|new| state.previous.as_ref() == Some(new))
    {
        return;
    }
    let regression = state
        .previous
        .as_ref()
        .zip(total.as_ref())
        .is_some_and(|(old, new)| counts_regress(old, new));
    if regression {
        state.epoch += 1;
        issue(
            report,
            "counterReset",
            "累计用量回退，已开启新的计数区间",
            Some(evidence.clone()),
        );
    }
    let (tokens, request_scoped) = if state.uncertain_counter {
        issue(
            report,
            "counterGap",
            "格式断点后的累计用量不重复回填，只保留明确单次记录",
            Some(evidence.clone()),
        );
        state.uncertain_counter = false;
        if let Some(last) = last {
            (last, true)
        } else {
            (TokenUsage::default(), false)
        }
    } else if regression {
        if let Some(last) = last {
            (last, true)
        } else {
            issue(
                report,
                "ambiguousReset",
                "累计回退缺少单次用量，保留未知计量",
                Some(evidence.clone()),
            );
            (TokenUsage::default(), false)
        }
    } else if let Some(total) = &total {
        let delta = subtract(total, state.previous.as_ref());
        let scoped = last.as_ref().is_some_and(|last| last == &delta);
        (delta, scoped)
    } else if let Some(last) = last {
        (last, true)
    } else {
        return;
    };
    let cumulative = total.as_ref().and_then(|v| v.total);
    let interval_start = if regression {
        cumulative
            .zip(tokens.total)
            .and_then(|(a, b)| a.checked_sub(b))
    } else {
        Some(previous_total)
    };
    state.previous = total;
    state.ordinal += 1;
    let id = if let Some(response) = p.response_id.as_deref() {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "response",
            response,
        ])
    } else {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "legacy",
            &fingerprint,
            &state.epoch.to_string(),
            &state.ordinal.to_string(),
        ])
    };
    let (model, effort) = measurement_context(
        p,
        state,
        owner.as_ref() == state.thread.as_ref(),
        turn.as_deref(),
    );
    facts.measurement(
        Candidate {
            measurement: Measurement {
                id,
                agent_kind: "codex".into(),
                source_instance_id: source.id.as_str().into(),
                thread_id: owner.map(Into::into),
                turn_id: turn.map(Into::into),
                response_id: p.response_id.clone(),
                timestamp: time,
                interval_end: None,
                grain: if request_scoped {
                    "response"
                } else {
                    "interval"
                }
                .into(),
                time_precision: precision(raw_time).into(),
                model,
                reasoning_effort: effort.map(Into::into),
                tokens,
                request_scoped,
                reported_cost: reported_cost(p.cost),
                service_tier: p.service_tier.as_deref().map(safe_text),
                sequence: evidence.line,
                evidence: vec![evidence],
            }
            .into(),
            direct: false,
            cumulative,
            interval_start,
            fingerprint,
        },
        report,
    );
}
