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
    pub total_tokens: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct TokenObservation {
    pub tokens: TokenUsage,
    pub reasons: TokenFields<Option<TokenUnavailableReason>>,
}
impl TokenObservation {
    pub(super) fn unavailable(reason: TokenUnavailableReason) -> Self {
        let tokens = TokenUsage::default();
        let reasons = tokens.unavailable_reasons(reason);
        Self { tokens, reasons }
    }
}

#[derive(Deserialize)]
struct RawCounts<'a> {
    #[serde(borrow, default, deserialize_with = "present_count")]
    input_tokens: Option<&'a RawValue>,
    #[serde(
        borrow,
        default,
        deserialize_with = "present_count",
        alias = "cache_read_input_tokens"
    )]
    cached_input_tokens: Option<&'a RawValue>,
    #[serde(
        borrow,
        default,
        deserialize_with = "present_count",
        alias = "cache_creation_input_tokens"
    )]
    cache_write_input_tokens: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present_count")]
    output_tokens: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present_count")]
    reasoning_output_tokens: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present_count")]
    total_tokens: Option<&'a RawValue>,
}

// Deserialize an explicitly present null as a raw value. Option's usual null
// handling would erase presence and incorrectly authorize protocol absence rules.
fn present_count<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<&'de RawValue>, D::Error> {
    <&RawValue>::deserialize(deserializer).map(Some)
}

pub(super) fn parse_tokens(
    raw: &RawValue,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) -> Option<TokenObservation> {
    let counts: RawCounts<'_> = match serde_json::from_str(raw.get()) {
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
    let mut observed = TokenObservation::unavailable(TokenUnavailableReason::Missing);
    for (field, value) in [
        (TokenField::RawInput, counts.input_tokens),
        (TokenField::CacheRead, counts.cached_input_tokens),
        (TokenField::CacheCreate, counts.cache_write_input_tokens),
        (TokenField::Output, counts.output_tokens),
        (TokenField::Reasoning, counts.reasoning_output_tokens),
        (TokenField::Total, counts.total_tokens),
    ] {
        let Some(raw) = value else {
            continue;
        };
        match serde_json::from_str::<u64>(raw.get()) {
            Ok(value) if value <= MAX_SAFE_INTEGER => {
                observed.tokens.set(field, Some(value));
                *observed.reasons.get_mut(field) = None;
            }
            value => {
                *observed.reasons.get_mut(field) = Some(TokenUnavailableReason::Invalid);
                let (code, message) = if value.is_ok() {
                    ("tokenOverflow", "用量计数超过安全整数范围")
                } else {
                    ("invalidTokens", "用量计数格式无效")
                };
                issue(report, code, message, Some(evidence.clone()));
            }
        }
    }
    let tokens = &mut observed.tokens;
    tokens.input = tokens
        .raw_input
        .zip(tokens.cache_read)
        .zip(tokens.cache_create)
        .and_then(|((raw, read), write)| raw.checked_sub(read)?.checked_sub(write));
    observed.reasons.input = if tokens.input.is_some() {
        None
    } else if [
        observed.reasons.raw_input,
        observed.reasons.cache_read,
        observed.reasons.cache_create,
    ]
    .contains(&Some(TokenUnavailableReason::Invalid))
        || tokens
            .raw_input
            .zip(tokens.cache_read)
            .zip(tokens.cache_create)
            .is_some()
    {
        Some(TokenUnavailableReason::Invalid)
    } else {
        Some(TokenUnavailableReason::Missing)
    };
    if tokens
        .raw_input
        .zip(tokens.cache_read)
        .is_some_and(|(input, cache)| cache > input)
        || tokens
            .raw_input
            .zip(tokens.cache_create)
            .is_some_and(|(input, write)| write > input)
        || (tokens
            .raw_input
            .zip(tokens.cache_read)
            .zip(tokens.cache_create)
            .is_some()
            && tokens.input.is_none())
    {
        issue(
            report,
            "invalidTokenCategories",
            "缓存计数超过输入计数",
            Some(evidence.clone()),
        );
        observed.reasons.input = Some(TokenUnavailableReason::Invalid);
    }
    let native_output = tokens.output;
    if tokens
        .reasoning
        .zip(tokens.output)
        .is_some_and(|(reasoning, output)| reasoning > output)
    {
        issue(
            report,
            "invalidTokenCategories",
            "推理计数超过输出计数",
            Some(evidence.clone()),
        );
        tokens.output = None;
        observed.reasons.output = Some(TokenUnavailableReason::Invalid);
    }
    // Preserve explicit native totals even when their categories disagree. Pricing
    // validates this relationship independently; no replacement total is invented.
    if tokens
        .raw_input
        .zip(native_output)
        .zip(tokens.total)
        .is_some_and(|((i, o), t)| i.checked_add(o) != Some(t))
    {
        issue(
            report,
            "tokenTotalMismatch",
            "Token 总量与输入输出不一致",
            Some(evidence.clone()),
        );
    }
    Some(observed)
}

pub(super) fn parse_legacy_tokens(
    raw: &RawValue,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) -> Option<TokenObservation> {
    let mut observed = parse_tokens(raw, report, evidence)?;
    // Only protocol absence establishes unsupported cache writes as zero. An
    // explicitly malformed cache-write value remains invalid.
    if observed.reasons.cache_create == Some(TokenUnavailableReason::Missing) {
        observed.tokens.cache_create = Some(0);
        observed.reasons.cache_create = None;
        observed.tokens.input = observed
            .tokens
            .raw_input
            .zip(observed.tokens.cache_read)
            .and_then(|(input, cache)| input.checked_sub(cache));
        observed.reasons.input = if observed.tokens.input.is_some() {
            None
        } else if [observed.reasons.raw_input, observed.reasons.cache_read]
            .contains(&Some(TokenUnavailableReason::Invalid))
            || observed
                .tokens
                .raw_input
                .zip(observed.tokens.cache_read)
                .is_some()
        {
            Some(TokenUnavailableReason::Invalid)
        } else {
            Some(TokenUnavailableReason::Missing)
        };
    }
    Some(observed)
}

pub(super) fn counts_regress(old: &TokenObservation, new: &TokenObservation) -> bool {
    [
        TokenField::RawInput,
        TokenField::CacheRead,
        TokenField::CacheCreate,
        TokenField::Output,
        TokenField::Total,
    ]
    .into_iter()
    .any(|field| {
        old.tokens
            .get(field)
            .zip(new.tokens.get(field))
            .is_some_and(|(a, b)| b < a)
    })
}
pub(super) fn subtract(
    new: &TokenObservation,
    old: Option<&TokenObservation>,
    initial: bool,
) -> TokenObservation {
    let mut delta = TokenObservation::unavailable(TokenUnavailableReason::Indeterminate);
    for field in TokenField::ALL {
        let current = new.tokens.get(field);
        let baseline = old.map_or(initial.then_some(0), |old| old.tokens.get(field));
        let value = current.zip(baseline).and_then(|(a, b)| a.checked_sub(b));
        delta.tokens.set(field, value);
        *delta.reasons.get_mut(field) = if value.is_some() {
            None
        } else if current.is_none() {
            *new.reasons.get(field)
        } else {
            Some(TokenUnavailableReason::Indeterminate)
        };
    }
    delta
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
