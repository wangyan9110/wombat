use super::*;
use crate::session_events::MeasurementContextField;
use serde_json::value::RawValue;

#[derive(Deserialize)]
pub(super) struct Envelope<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: &'a str,
    #[serde(borrow)]
    pub timestamp: Option<&'a str>,
    #[serde(borrow)]
    pub payload: &'a RawValue,
    #[serde(borrow)]
    pub metadata: Option<&'a RawValue>,
}

/// Unknown fields, including messages and outputs, are skipped by serde without allocation.
#[derive(Default, Deserialize)]
pub(super) struct Payload<'a> {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub id: Option<String>,
    pub session_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub response_id: Option<String>,
    pub forked_from_id: Option<String>,
    pub cli_version: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    #[serde(alias = "model_provider_id")]
    pub model_provider: Option<String>,
    pub api_provider: Option<String>,
    pub effort: Option<String>,
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
    #[serde(borrow)]
    pub cost: Option<&'a RawValue>,
    #[serde(borrow)]
    pub collaboration_mode: Option<&'a RawValue>,
    #[serde(borrow)]
    pub settings: Option<&'a RawValue>,
    #[serde(borrow)]
    pub thread_settings: Option<&'a RawValue>,
    #[serde(borrow)]
    pub usage: Option<&'a RawValue>,
    #[serde(borrow)]
    pub thread_token_usage: Option<&'a RawValue>,
    #[serde(borrow)]
    pub info: Option<&'a RawValue>,
    #[serde(borrow)]
    pub latest_token_usage_record: Option<&'a RawValue>,
    pub compaction_response_id: Option<String>,
    #[serde(borrow)]
    pub item: Option<&'a RawValue>,
    pub name: Option<String>,
    pub namespace: Option<String>,
    #[serde(borrow)]
    pub invocation: Option<&'a RawValue>,
    #[serde(borrow)]
    pub duration: Option<&'a RawValue>,
    #[serde(alias = "callId")]
    pub call_id: Option<String>,
    #[serde(alias = "itemId")]
    pub item_id: Option<String>,
    #[serde(borrow)]
    pub arguments: Option<&'a RawValue>,
    #[serde(borrow)]
    pub input: Option<&'a RawValue>,
    #[serde(borrow)]
    pub output: Option<&'a RawValue>,
    #[serde(borrow)]
    pub result: Option<&'a RawValue>,
    pub status: Option<String>,
    #[serde(borrow)]
    pub success: Option<&'a RawValue>,
    #[serde(borrow)]
    pub changes: Option<&'a RawValue>,
    #[serde(borrow)]
    pub parsed_cmd: Option<&'a RawValue>,
    #[serde(borrow)]
    pub source: Option<&'a RawValue>,
    #[serde(alias = "exitCode")]
    pub exit_code: Option<i64>,
    #[serde(borrow, alias = "durationMs")]
    pub duration_ms: Option<&'a RawValue>,
    #[serde(borrow)]
    pub started_at_ms: Option<&'a RawValue>,
    #[serde(borrow)]
    pub completed_at_ms: Option<&'a RawValue>,
    #[serde(borrow)]
    pub time_to_first_token_ms: Option<&'a RawValue>,
    #[serde(borrow)]
    pub model_context_window: Option<&'a RawValue>,
    pub server: Option<String>,
    pub tool: Option<String>,
    pub path: Option<String>,
    pub role: Option<String>,
    #[serde(borrow)]
    pub content: Option<&'a RawValue>,
    #[serde(borrow)]
    pub message: Option<&'a RawValue>,
    #[serde(borrow)]
    pub delta: Option<&'a RawValue>,
    #[serde(borrow)]
    pub phase: Option<&'a RawValue>,
    #[serde(borrow)]
    pub internal_chat_message_metadata_passthrough: Option<&'a RawValue>,
}

#[derive(Deserialize)]
pub(super) struct UsageInfo<'a> {
    #[serde(borrow)]
    pub total_token_usage: Option<&'a RawValue>,
    #[serde(borrow)]
    pub last_token_usage: Option<&'a RawValue>,
}
#[derive(Default, Deserialize)]
pub(super) struct Counts {
    pub input_tokens: Option<u64>,
    #[serde(alias = "cache_read_input_tokens")]
    pub cached_input_tokens: Option<u64>,
    #[serde(alias = "cache_creation_input_tokens")]
    pub cache_write_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

pub(super) fn parse_tokens(
    raw: &RawValue,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) -> Option<TokenUsage> {
    let counts: Counts = match serde_json::from_str(raw.get()) {
        Ok(value) => value,
        Err(_) => {
            issue(
                report,
                "invalidTokens",
                "用量计数格式无效",
                Some(evidence.clone()),
            );
            return None;
        }
    };
    if [
        counts.input_tokens,
        counts.cached_input_tokens,
        counts.cache_write_input_tokens,
        counts.output_tokens,
        counts.reasoning_output_tokens,
        counts.total_tokens,
    ]
    .into_iter()
    .flatten()
    .any(|v| v > MAX_SAFE_INTEGER)
    {
        issue(
            report,
            "tokenOverflow",
            "用量计数超过安全整数范围",
            Some(evidence.clone()),
        );
        return None;
    }
    // Absent cache categories remain unknown. Codex input includes both cache subcategories.
    let input = counts
        .input_tokens
        .zip(counts.cached_input_tokens)
        .zip(counts.cache_write_input_tokens)
        .and_then(|((raw, read), write)| raw.checked_sub(read)?.checked_sub(write));
    if counts
        .input_tokens
        .zip(counts.cached_input_tokens)
        .is_some_and(|(input, cache)| cache > input)
        || counts
            .input_tokens
            .zip(counts.cache_write_input_tokens)
            .is_some_and(|(input, write)| write > input)
    {
        issue(
            report,
            "invalidTokenCategories",
            "缓存计数超过输入计数",
            Some(evidence.clone()),
        );
    }
    let mut output = counts.output_tokens;
    if counts
        .reasoning_output_tokens
        .zip(output)
        .is_some_and(|(reasoning, output)| reasoning > output)
    {
        issue(
            report,
            "invalidTokenCategories",
            "推理计数超过输出计数",
            Some(evidence.clone()),
        );
        output = None;
    }
    if counts
        .input_tokens
        .zip(counts.output_tokens)
        .zip(counts.total_tokens)
        .is_some_and(|((i, o), t)| i.checked_add(o) != Some(t))
    {
        issue(
            report,
            "tokenTotalMismatch",
            "Token 总量与输入输出不一致",
            Some(evidence.clone()),
        );
    }
    Some(TokenUsage {
        input,
        cache_read: counts.cached_input_tokens,
        cache_create: counts.cache_write_input_tokens,
        output,
        reasoning: counts.reasoning_output_tokens,
        total: counts.total_tokens,
        raw_input: counts.input_tokens,
    })
}

pub(super) fn parse_legacy_tokens(
    raw: &RawValue,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) -> Option<TokenUsage> {
    let mut tokens = parse_tokens(raw, report, evidence)?;
    // Legacy Codex TokenUsage has no separate cache-write category. Its absent field
    // means that category is not supported by that protocol, not an unknown modern value.
    if tokens.cache_create.is_none() {
        tokens.cache_create = Some(0);
        tokens.input = tokens
            .raw_input
            .zip(tokens.cache_read)
            .and_then(|(input, cache)| input.checked_sub(cache));
    }
    Some(tokens)
}

pub(super) fn counts_regress(old: &TokenUsage, new: &TokenUsage) -> bool {
    [
        (old.raw_input, new.raw_input),
        (old.cache_read, new.cache_read),
        (old.cache_create, new.cache_create),
        (old.output, new.output),
        (old.total, new.total),
    ]
    .into_iter()
    .any(|(a, b)| a.zip(b).is_some_and(|(a, b)| b < a))
}
pub(super) fn subtract(new: &TokenUsage, old: Option<&TokenUsage>) -> TokenUsage {
    let zero = TokenUsage {
        input: Some(0),
        cache_read: Some(0),
        cache_create: Some(0),
        output: Some(0),
        reasoning: Some(0),
        total: Some(0),
        raw_input: Some(0),
    };
    let old = old.unwrap_or(&zero);
    let diff = |a: Option<u64>, b: Option<u64>| a.zip(b).and_then(|(a, b)| a.checked_sub(b));
    TokenUsage {
        input: diff(new.input, old.input),
        cache_read: diff(new.cache_read, old.cache_read),
        cache_create: diff(new.cache_create, old.cache_create),
        output: diff(new.output, old.output),
        reasoning: diff(new.reasoning, old.reasoning),
        total: diff(new.total, old.total),
        raw_input: diff(new.raw_input, old.raw_input),
    }
}

pub(super) fn context_fields(
    p: &Payload<'_>,
) -> (ModelRef, Option<String>, Vec<MeasurementContextField>) {
    #[derive(Deserialize)]
    struct Collaboration<'a> {
        #[serde(borrow)]
        settings: Option<&'a RawValue>,
    }
    let settings = p.settings.or(p.thread_settings).or_else(|| {
        p.collaboration_mode
            .and_then(|raw| serde_json::from_str::<Collaboration>(raw.get()).ok())
            .and_then(|v| v.settings)
    });
    let nested = settings.and_then(|raw| serde_json::from_str::<Payload>(raw.get()).ok());
    let models = [
        p.model.as_deref(),
        nested.as_ref().and_then(|p| p.model.as_deref()),
    ];
    let efforts = [
        p.effort.as_deref(),
        p.reasoning_effort.as_deref(),
        nested.as_ref().and_then(|p| p.reasoning_effort.as_deref()),
    ];
    let providers = [
        p.model_provider.as_deref(),
        nested.as_ref().and_then(|p| p.model_provider.as_deref()),
    ];
    let api_providers = [
        p.api_provider.as_deref(),
        nested.as_ref().and_then(|p| p.api_provider.as_deref()),
    ];
    let unique = |values: &[Option<&str>]| -> (Option<String>, bool) {
        let set: BTreeSet<_> = values.iter().flatten().copied().collect();
        (
            if set.len() == 1 {
                set.first().map(|s| safe_text(s))
            } else {
                None
            },
            set.len() > 1,
        )
    };
    let (model, mconflict) = unique(&models);
    let (effort, econflict) = unique(&efforts);
    let (provider, pconflict) = unique(&providers);
    let (api_provider, aconflict) = unique(&api_providers);
    (
        ModelRef {
            raw: model.map(Into::into),
            provider: provider.map(Into::into),
            api_provider: api_provider.map(Into::into),
            pricing_model: None,
        },
        effort,
        [
            (MeasurementContextField::Model, mconflict),
            (MeasurementContextField::Provider, pconflict),
            (MeasurementContextField::ApiProvider, aconflict),
            (MeasurementContextField::Effort, econflict),
        ]
        .into_iter()
        .filter_map(|(field, conflict)| conflict.then_some(field))
        .collect(),
    )
}
pub(super) fn measurement_context(
    p: &Payload<'_>,
    state: &State,
    same_owner: bool,
    turn: Option<&str>,
) -> (ModelRef, Option<String>, Vec<MeasurementContextField>) {
    let (explicit_model, explicit_effort, mut conflicts) = context_fields(p);
    let same_turn = state.turn.is_none() || state.turn.as_deref() == turn;
    let current_model = if same_turn {
        &state.model
    } else {
        &state.thread_model
    };
    let current_effort = if same_turn {
        &state.effort
    } else {
        &state.thread_effort
    };
    if same_owner {
        context::inherit_conflicts(
            &explicit_model,
            explicit_effort.as_deref(),
            if same_turn {
                &state.context_conflicts
            } else {
                &state.thread_context_conflicts
            },
            &mut conflicts,
        );
    }
    let model = ModelRef {
        raw: explicit_model.raw.or_else(|| {
            (same_owner && !conflicts.contains(&MeasurementContextField::Model))
                .then(|| current_model.raw.clone())
                .flatten()
        }),
        provider: explicit_model.provider.or_else(|| {
            (same_owner && !conflicts.contains(&MeasurementContextField::Provider))
                .then(|| current_model.provider.clone())
                .flatten()
        }),
        api_provider: explicit_model.api_provider.or_else(|| {
            (same_owner && !conflicts.contains(&MeasurementContextField::ApiProvider))
                .then(|| current_model.api_provider.clone())
                .flatten()
        }),
        pricing_model: None,
    };
    (
        model,
        explicit_effort.or_else(|| {
            (same_owner && !conflicts.contains(&MeasurementContextField::Effort))
                .then(|| current_effort.clone())
                .flatten()
        }),
        conflicts,
    )
}
