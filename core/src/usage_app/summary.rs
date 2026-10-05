//! Checked ledger aggregation keeps missing, zero, unpriced and cost shares distinct.
use super::*;
pub(super) fn checked_sum(
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
    let input_total = checked_sum(rows, total_input)?;
    let cache_read = checked_sum(rows, |t| t.cache_read)?;
    // Validate stored parts even for a single row; preserve its request-specific basis.
    let price = crate::pricing::sum_prices(rows.iter().map(|r| r.price.as_ref()))
        .map_err(|e| operation_error("PRICING_ERROR", e))?;
    Ok(UsageSummary {
        input_total,
        cache_hit_rate: rows
            .iter()
            .all(|row| input_categories_consistent(&row.fact.tokens))
            .then(|| share(cache_read, input_total))
            .flatten(),
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
            rows[0].price.as_ref().clone()
        } else {
            price
        },
        measurement_count: rows.len(),
    })
}

fn total_input(tokens: &TokenUsage) -> Option<u64> {
    // Native input already includes cache reads and writes. Missing breakdowns do
    // not erase it. A missing native value can also be a sticky conflict, even
    // when replay filled every category, so do not reconstruct it from parts.
    tokens.raw_input
}

fn input_categories_consistent(tokens: &TokenUsage) -> bool {
    let Some(total) = total_input(tokens) else {
        return false;
    };
    // Validate each measurement before aggregation: another request's input must
    // not conceal an impossible cache count. Missing writes are not assumed zero.
    let Some(known_parts) = [tokens.input, tokens.cache_read, tokens.cache_create]
        .into_iter()
        .flatten()
        .try_fold(0u64, u64::checked_add)
    else {
        return false;
    };
    known_parts <= total
        && (![tokens.input, tokens.cache_read, tokens.cache_create]
            .iter()
            .all(Option::is_some)
            || known_parts == total)
}
pub(super) fn share(value: Option<u64>, total: Option<u64>) -> Option<f64> {
    value
        .zip(total)
        .filter(|(_, t)| *t > 0)
        .map(|(v, t)| v as f64 / t as f64)
}
pub(super) fn known_cost(summary: &UsageSummary) -> Option<Decimal> {
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
pub(super) fn unpriced_tokens(rows: &[&PricedMeasurement]) -> Result<Option<u64>> {
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
pub(super) fn cost_share(value: &UsageSummary, total: &UsageSummary) -> Option<f64> {
    known_cost(value)
        .zip(known_cost(total))
        .filter(|(_, total)| *total > Decimal::ZERO)
        .and_then(|(value, total)| (value / total).to_f64())
}
pub(super) fn consumption_order(
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

#[cfg(test)]
mod tests;
