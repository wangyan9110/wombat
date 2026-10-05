use super::*;
use std::sync::Arc;

fn row(tokens: TokenUsage) -> PricedMeasurement {
    let model = ModelRef {
        raw: Some("gpt-5.4".into()),
        provider: Some("openai".into()),
        api_provider: None,
        pricing_model: None,
    };
    let price = crate::pricing::price(&model, &tokens);
    PricedMeasurement {
        fact: Arc::new(Measurement {
            id: "synthetic-measurement".into(),
            agent_kind: "codex".into(),
            source_instance_id: "synthetic-source".into(),
            thread_id: Some("synthetic-thread".into()),
            turn_id: Some("synthetic-turn".into()),
            response_id: None,
            timestamp: None,
            interval_end: None,
            grain: "response".into(),
            time_precision: "unknown".into(),
            model,
            reasoning_effort: None,
            tokens,
            request_scoped: true,
            reported_cost: None,
            service_tier: None,
            sequence: 1,
            evidence: vec![],
        }),
        price: Arc::new(price),
    }
}

fn incomplete(raw: u64, cache: u64) -> TokenUsage {
    TokenUsage {
        raw_input: Some(raw),
        cache_read: Some(cache),
        output: Some(10),
        total: Some(raw + 10),
        ..Default::default()
    }
}

#[test]
fn native_input_survives_missing_breakdown_without_changing_tokens_or_price() {
    let measurement = row(incomplete(100, 60));
    let before = measurement.clone();
    let summary = summarize(&[&measurement]).unwrap();
    assert_eq!(summary.input_total, Some(100));
    assert_eq!(summary.cache_hit_rate, Some(0.6));
    assert_eq!(summary.tokens, before.fact.tokens);
    assert_eq!(summary.price, *before.price);
    assert_eq!(summary.tokens.input, None);
    assert_eq!(summary.tokens.cache_create, None);
    assert_eq!(summary.tokens.total, Some(110));
}

#[test]
fn zero_input_has_no_ratio_and_missing_cache_is_not_zero() {
    let zero = row(incomplete(0, 0));
    let summary = summarize(&[&zero]).unwrap();
    assert_eq!(summary.input_total, Some(0));
    assert_eq!(summary.cache_hit_rate, None);
    let missing_cache = row(TokenUsage {
        raw_input: Some(100),
        ..Default::default()
    });
    let summary = summarize(&[&missing_cache]).unwrap();
    assert_eq!(summary.input_total, Some(100));
    assert_eq!(summary.cache_hit_rate, None);
    assert_eq!(summary.tokens.cache_read, None);
}

#[test]
fn impossible_categories_cannot_produce_a_ratio_even_in_a_larger_mixed_total() {
    let valid = row(incomplete(1000, 60));
    for tokens in [
        incomplete(100, 101),
        TokenUsage {
            cache_create: Some(50),
            ..incomplete(100, 60)
        },
        TokenUsage {
            input: Some(30),
            cache_create: Some(0),
            ..incomplete(100, 60)
        },
    ] {
        let invalid = row(tokens);
        let summary = summarize(&[&invalid, &valid]).unwrap();
        assert_eq!(summary.input_total, Some(1100));
        assert_eq!(summary.cache_hit_rate, None);
    }
}

#[test]
fn mixed_complete_and_incomplete_breakdowns_conserve_native_input_totals() {
    let native = row(incomplete(100, 60));
    let parts = row(TokenUsage {
        raw_input: Some(100),
        input: Some(50),
        cache_read: Some(20),
        cache_create: Some(30),
        output: Some(10),
        total: Some(110),
        ..Default::default()
    });
    let summary = summarize(&[&native, &parts]).unwrap();
    assert_eq!(summary.input_total, Some(200));
    assert_eq!(summary.cache_hit_rate, Some(0.4));
    assert_eq!(summary.tokens.raw_input, Some(200));
    assert_eq!(summary.tokens.input, None);
    assert_eq!(summary.tokens.cache_create, None);
    assert_eq!(summary.tokens.total, Some(220));
    let absent = row(TokenUsage::default());
    let partial = summarize(&[&native, &absent]).unwrap();
    assert_eq!(partial.input_total, None);
    assert_eq!(partial.cache_hit_rate, None);
}

#[test]
fn native_input_aggregation_rejects_unsafe_counts_and_aggregate_overflow() {
    let one = row(TokenUsage {
        raw_input: Some(1),
        ..Default::default()
    });
    for large in [MAX_SAFE_INTEGER, u64::MAX] {
        let large = row(TokenUsage {
            raw_input: Some(large),
            ..Default::default()
        });
        let error = summarize(&[&large, &one]).unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<crate::dto::OperationError>()
                .unwrap()
                .code,
            "RESOURCE_LIMIT"
        );
    }
}

fn collect(rows: &[serde_json::Value]) -> Vec<PricedMeasurement> {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("sessions")).unwrap();
    std::fs::write(
        directory.path().join("sessions/synthetic.jsonl"),
        rows.iter().map(|v| format!("{v}\n")).collect::<String>(),
    )
    .unwrap();
    let collected = adapters::collect(
        &DiscoveryRequest {
            roots: vec![directory.path().into()],
        },
        &RunContext::default(),
    );
    collected
        .measurements
        .into_iter()
        .map(|measurement| {
            let price = crate::pricing::price_with_context(
                &measurement.model,
                &measurement.tokens,
                &crate::pricing::PricingContext {
                    request_scoped: measurement.request_scoped,
                },
            );
            PricedMeasurement {
                fact: measurement,
                price: Arc::new(price),
            }
        })
        .collect()
}

fn metadata() -> serde_json::Value {
    serde_json::json!({"type":"session_meta","payload":{"id":"synthetic-thread"}})
}

#[test]
fn reconciled_conflicts_stay_null_instead_of_becoming_reconstructed_counts() {
    let direct = |raw, cache, total| {
        serde_json::json!({"type":"event_msg","payload":{
            "type":"token_usage_record","thread_id":"synthetic-thread",
            "response_id":"synthetic-response","usage":{
                "input_tokens":raw,"cached_input_tokens":cache,
                "cache_write_input_tokens":0,"output_tokens":10,"total_tokens":total
            }
        }})
    };
    let rows = collect(&[metadata(), direct(100, 60, 110), direct(110, 70, 120)]);
    assert_eq!(rows.len(), 1);
    let summary = summarize(&rows.iter().collect::<Vec<_>>()).unwrap();
    assert_eq!(summary.tokens.raw_input, None);
    assert_eq!(summary.tokens.cache_read, None);
    assert_eq!(summary.tokens.total, None);
    assert_eq!(summary.input_total, None);
    assert_eq!(summary.cache_hit_rate, None);
    let rows = collect(&[metadata(), direct(100, 60, 110), direct(100, 60, 111)]);
    let summary = summarize(&rows.iter().collect::<Vec<_>>()).unwrap();
    assert_eq!(summary.tokens.total, None);
    assert_eq!(summary.input_total, Some(100));
    assert_eq!(summary.cache_hit_rate, Some(0.6));
}

#[test]
fn categories_completed_by_replay_do_not_restore_conflicting_native_input() {
    let first = serde_json::json!({"type":"event_msg","payload":{
        "type":"token_usage_record","thread_id":"synthetic-thread",
        "response_id":"synthetic-response","usage":{
            "input_tokens":100,"cache_write_input_tokens":0,
            "output_tokens":10,"total_tokens":110
        }
    }});
    let second = serde_json::json!({"type":"event_msg","payload":{
        "type":"token_usage_record","thread_id":"synthetic-thread",
        "response_id":"synthetic-response","usage":{
            "input_tokens":110,"cached_input_tokens":60,"cache_write_input_tokens":0,
            "output_tokens":10,"total_tokens":120
        }
    }});
    for events in [
        [metadata(), first.clone(), second.clone()],
        [metadata(), second.clone(), first.clone()],
    ] {
        let rows = collect(&events);
        assert_eq!(rows.len(), 1);
        let summary = summarize(&rows.iter().collect::<Vec<_>>()).unwrap();
        assert_eq!(summary.tokens.raw_input, None);
        assert_eq!(summary.tokens.input, Some(50));
        assert_eq!(summary.tokens.cache_read, Some(60));
        assert_eq!(summary.tokens.cache_create, Some(0));
        assert_eq!(summary.tokens.total, None);
        assert_eq!(summary.input_total, None);
        assert_eq!(summary.cache_hit_rate, None);
    }
    // TokenUsage alone cannot prove whether absent native input was never
    // recorded or nulled by reconciliation. Complete parts do not authorize it.
    let parts_only = row(TokenUsage {
        input: Some(50),
        cache_read: Some(60),
        cache_create: Some(0),
        ..Default::default()
    });
    let summary = summarize(&[&parts_only]).unwrap();
    assert_eq!(summary.input_total, None);
    assert_eq!(summary.cache_hit_rate, None);
}

#[test]
fn cumulative_differences_keep_the_ledger_and_price_conserved() {
    let counter = |input, cache, output| {
        serde_json::json!({"type":"event_msg","payload":{
            "type":"token_count","info":{"total_token_usage":{
                "input_tokens":input,"cached_input_tokens":cache,
                "output_tokens":output,"total_tokens":input+output
            }}
        }})
    };
    let rows = collect(&[metadata(), counter(100, 60, 10), counter(300, 120, 40)]);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].fact.tokens.cache_create, Some(0));
    let summaries = rows
        .iter()
        .map(|row| summarize(&[row]).unwrap())
        .collect::<Vec<_>>();
    let summary = summarize(&rows.iter().collect::<Vec<_>>()).unwrap();
    assert_eq!(summary.input_total, Some(300));
    assert_eq!(summary.tokens.input, Some(180));
    assert_eq!(summary.tokens.cache_read, Some(120));
    assert_eq!(summary.tokens.cache_create, Some(0));
    assert_eq!(summary.tokens.output, Some(40));
    assert_eq!(summary.tokens.total, Some(340));
    assert_eq!(summary.cache_hit_rate, Some(0.4));
    assert_eq!(
        summaries
            .iter()
            .map(|s| s.input_total.unwrap())
            .sum::<u64>(),
        300
    );
    assert_eq!(
        summary.price,
        crate::pricing::sum_prices(rows.iter().map(|r| r.price.as_ref())).unwrap()
    );
}
