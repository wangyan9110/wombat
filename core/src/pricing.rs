//! Wombat's offline standard API-equivalent prices. Source-reported money is not
//! an input to this module: it remains an independent source fact.
use crate::adapters::contract::{ModelRef, TokenUsage};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    str::FromStr,
    sync::{Arc, OnceLock},
};

const CATALOG_JSON: &str = include_str!("../prices/openai-standard-2026-09-30.json");
pub const PRICE_REVISION: &str = "openai-standard-2026-09-30.2";
pub const PRICE_POLICY: &str = "official-standard-api-equivalent-v1";
const CATEGORIES: [&str; 4] = ["input", "cacheRead", "cacheCreate", "output"];

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PriceComponent {
    pub category: Arc<str>,
    pub tokens: Option<u64>,
    pub cost: Option<String>,
    pub known_cost: String,
    pub status: Arc<str>,
    pub rate_per_million: Option<Arc<str>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct PriceBasis {
    pub original_model: Arc<str>,
    pub pricing_model: Arc<str>,
    pub model_provider: Arc<str>,
    pub api_provider: Option<Arc<str>>,
    pub match_method: Arc<str>,
    pub source: Arc<str>,
    pub verified_at: Arc<str>,
    pub price_revision: Arc<str>,
    pub catalog_hash: Arc<str>,
    /// standard, longContext, conditionUnknown
    pub condition: Arc<str>,
    pub request_input_tokens: Option<u64>,
    pub request_scoped: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PriceResult {
    pub currency: Arc<str>,
    pub policy: Arc<str>,
    pub price_revision: Arc<str>,
    /// Present only when every applicable Token category has a known amount.
    pub cost: Option<String>,
    pub known_cost: String,
    /// priced, partial, unknown
    pub status: Arc<str>,
    pub components: Vec<PriceComponent>,
    pub basis: Vec<PriceBasis>,
    pub issues: Vec<Arc<str>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PricingContext {
    /// False for an aggregate cumulative difference spanning unknown requests.
    pub request_scoped: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceCatalogInfo {
    pub revision: String,
    pub hash: String,
    pub verified_at: String,
    pub policy: String,
    pub currency: String,
    pub models: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub revision: String,
    pub verified_at: String,
    pub policy: String,
    pub currency: String,
    pub models: Vec<ModelPrice>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelPrice {
    pub id: String,
    pub aliases: Vec<String>,
    pub source: String,
    pub rates: Rates,
    pub long_context: Option<LongContext>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LongContext {
    pub input_above: u64,
    pub rates: Rates,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rates {
    pub input: Option<String>,
    pub cache_read: Option<String>,
    pub cache_create: Option<String>,
    pub output: Option<String>,
}

pub(crate) fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(CATALOG_JSON).expect("embedded price catalog is valid")
    })
}

pub fn catalog_info() -> PriceCatalogInfo {
    static HASH: OnceLock<String> = OnceLock::new();
    let catalog = catalog();
    PriceCatalogInfo {
        revision: catalog.revision.clone(),
        hash: HASH
            .get_or_init(|| format!("{:x}", Sha256::digest(CATALOG_JSON)))
            .clone(),
        verified_at: catalog.verified_at.clone(),
        policy: catalog.policy.clone(),
        currency: catalog.currency.clone(),
        models: catalog.models.iter().map(|m| m.id.clone()).collect(),
    }
}

/// Convenience for an individual request. Cumulative differences must call
/// price_with_context with request_scoped=false instead.
pub fn price(model: &ModelRef, tokens: &TokenUsage) -> PriceResult {
    price_with_context(
        model,
        tokens,
        &PricingContext {
            request_scoped: true,
        },
    )
}

pub fn price_with_context(
    model: &ModelRef,
    tokens: &TokenUsage,
    context: &PricingContext,
) -> PriceResult {
    price_with_catalog(model, tokens, context, catalog(), &catalog_info().hash)
}

pub(crate) fn price_with_catalog(
    model: &ModelRef,
    tokens: &TokenUsage,
    context: &PricingContext,
    catalog: &Catalog,
    catalog_hash: &str,
) -> PriceResult {
    let mut result = empty_price();
    result.price_revision = catalog.revision.as_str().into();
    let counts = [
        tokens.input,
        tokens.cache_read,
        tokens.cache_create,
        tokens.output,
    ];
    let input_sum = sum_known(&counts[..3]);
    let all_sum = sum_known(&counts);
    let invalid = (tokens
        .reasoning
        .zip(tokens.output)
        .is_some_and(|(r, o)| r > o))
        || tokens
            .raw_input
            .zip(input_sum)
            .is_some_and(|(raw, sum)| raw != sum)
        || tokens
            .total
            .zip(all_sum)
            .is_some_and(|(total, sum)| total != sum)
        || (counts.iter().all(Option::is_some) && all_sum.is_none());
    if invalid {
        result.issues.push("inconsistentTokenCounts".into());
    }
    let matched = match_model(model, catalog);
    if matched.is_none() {
        result.issues.push("unverifiedModel".into());
    }
    let request_input = context
        .request_scoped
        .then_some(tokens.raw_input.or(input_sum))
        .flatten();
    let mut active_rates = None;
    if let Some((entry, method)) = matched {
        let (rates, condition) = match &entry.long_context {
            None => (Some(&entry.rates), "standard"),
            Some(tier) => match request_input {
                Some(input) if input > tier.input_above => (Some(&tier.rates), "longContext"),
                Some(_) => (Some(&entry.rates), "standard"),
                None => (None, "conditionUnknown"),
            },
        };
        if rates.is_none() {
            result.issues.push("requestContextUnknown".into());
        }
        active_rates = rates;
        result.basis.push(PriceBasis {
            original_model: model.raw.as_deref().unwrap_or_default().into(),
            pricing_model: entry.id.as_str().into(),
            model_provider: "openai".into(),
            api_provider: model.api_provider.as_deref().map(Into::into),
            match_method: method.into(),
            source: entry.source.as_str().into(),
            verified_at: catalog.verified_at.as_str().into(),
            price_revision: catalog.revision.as_str().into(),
            catalog_hash: catalog_hash.into(),
            condition: condition.into(),
            request_input_tokens: request_input,
            request_scoped: context.request_scoped,
        });
    }
    let rates = active_rates
        .map(|rates| {
            [
                rates.input.as_deref(),
                rates.cache_read.as_deref(),
                rates.cache_create.as_deref(),
                rates.output.as_deref(),
            ]
        })
        .unwrap_or([None; 4]);
    let mut known_total = Decimal::ZERO;
    let mut any_known_usage = false;
    let mut complete = !invalid;
    for (index, category) in CATEGORIES.iter().enumerate() {
        let count = counts[index];
        let rate = rates[index].and_then(|rate| Decimal::from_str(rate).ok());
        let cost = if invalid {
            None
        } else if count == Some(0) {
            Some(Decimal::ZERO)
        } else {
            count.zip(rate).and_then(|(count, rate)| {
                Decimal::from(count)
                    .checked_mul(rate)?
                    .checked_div(Decimal::from(1_000_000))
            })
        };
        if let Some(cost) = cost {
            known_total += cost;
            any_known_usage |= count.is_some_and(|n| n > 0);
        } else {
            complete = false;
            result.issues.push(format!("{category}PriceUnknown").into());
        }
        result.components.push(PriceComponent {
            category: (*category).into(),
            tokens: count,
            cost: cost.map(decimal_string),
            known_cost: decimal_string(cost.unwrap_or(Decimal::ZERO)),
            status: if cost.is_some() { "priced" } else { "unknown" }.into(),
            rate_per_million: if invalid {
                None
            } else {
                rates[index].map(Into::into)
            },
        });
    }
    // Fetching a catalog can repair missing rates, but cannot repair missing log evidence.
    if !invalid
        && model.raw.as_deref().is_some_and(|name| !name.is_empty())
        && model.provider.as_deref().is_none_or(|p| p == "openai")
        && model.api_provider.as_deref().is_none_or(|p| p == "openai")
        && (matched.is_none() || active_rates.is_some())
        && counts
            .iter()
            .zip(rates)
            .any(|(count, rate)| count.is_some_and(|n| n > 0) && rate.is_none())
    {
        result.issues.push("catalogPriceMissing".into());
    }
    result.known_cost = decimal_string(known_total);
    result.cost = complete.then(|| result.known_cost.clone());
    result.status = status(complete, any_known_usage).into();
    result
}

fn sum_known(values: &[Option<u64>]) -> Option<u64> {
    values
        .iter()
        .try_fold(0_u64, |sum, value| sum.checked_add((*value)?))
}

fn match_model<'a>(
    model: &ModelRef,
    catalog: &'a Catalog,
) -> Option<(&'a ModelPrice, &'static str)> {
    // Provider overrides and arbitrary pricing_model strings do not authorize
    // interpreting a third-party model as a similarly named OpenAI model.
    if model.provider.as_deref().is_some_and(|p| p != "openai")
        || model.api_provider.as_deref().is_some_and(|p| p != "openai")
    {
        return None;
    }
    let raw = model.raw.as_deref()?;
    catalog.models.iter().find_map(|entry| {
        if raw == entry.id {
            Some((entry, "exact"))
        } else if entry.aliases.iter().any(|alias| alias == raw) {
            Some((entry, "officialSnapshot"))
        } else {
            None
        }
    })
}

fn empty_price() -> PriceResult {
    PriceResult {
        currency: "USD".into(),
        policy: PRICE_POLICY.into(),
        price_revision: PRICE_REVISION.into(),
        cost: Some("0".into()),
        known_cost: "0".into(),
        status: "priced".into(),
        components: Vec::new(),
        basis: Vec::new(),
        issues: Vec::new(),
    }
}

fn decimal_string(value: Decimal) -> String {
    value.normalize().to_string()
}
fn status(complete: bool, any_known_usage: bool) -> &'static str {
    if complete {
        "priced"
    } else if any_known_usage {
        "partial"
    } else {
        "unknown"
    }
}
fn parse_amount(value: &str) -> Result<Decimal, String> {
    let parsed = if let Some((base, _)) = value.split_once(['e', 'E']) {
        // Old JSON numbers may use scientific notation. Verify the mantissa
        // exactly before the library applies its checked exponent conversion.
        Decimal::from_str_exact(base).and_then(|_| Decimal::from_scientific(value))
    } else {
        Decimal::from_str_exact(value)
    };
    let amount = parsed.map_err(|_| "invalidDecimalAmount".to_owned())?;
    if amount.is_sign_negative() {
        return Err("negativeDecimalAmount".into());
    }
    Ok(amount)
}

fn add_exact(left: Decimal, right: Decimal) -> Result<Decimal, String> {
    let sum = left.checked_add(right).ok_or("decimalAmountOverflow")?;
    // Decimal can reduce scale at its precision boundary. Reject that loss
    // instead of silently discarding a small charge next to a large amount.
    if sum.checked_sub(left) != Some(right) || sum.checked_sub(right) != Some(left) {
        return Err("decimalPrecisionLoss".into());
    }
    Ok(sum)
}

/// Read compatibility only: an old stored amount is not relabeled as a newly
/// verified official API equivalent and never triggers current-price replay.
pub fn legacy_price(cost: Option<&str>) -> Result<PriceResult, String> {
    let mut result = empty_price();
    result.policy = "legacy_recorded".into();
    result.price_revision = "legacy".into();
    let amount = cost.map(parse_amount).transpose()?;
    result.cost = amount.map(decimal_string);
    result.known_cost = decimal_string(amount.unwrap_or(Decimal::ZERO));
    result.status = if amount.is_some() {
        "priced"
    } else {
        "unknown"
    }
    .into();
    Ok(result)
}

/// Aggregates persisted exact decimal amounts, never rounded display strings or
/// daily Token counts. Empty input is the exact additive identity.
pub fn sum_prices<'a>(
    values: impl IntoIterator<Item = &'a PriceResult>,
) -> Result<PriceResult, String> {
    let mut result = empty_price();
    let mut total = Decimal::ZERO;
    let mut complete = true;
    let mut known = false;
    let mut basis = BTreeSet::new();
    let mut issues = BTreeSet::new();
    let mut revisions = BTreeSet::new();
    let mut policy: Option<&str> = None;
    let mut components: Vec<Vec<&PriceComponent>> = vec![Vec::new(); 4];
    for value in values {
        if value.currency.as_ref() != "USD"
            || ![PRICE_POLICY, "legacy_recorded"].contains(&value.policy.as_ref())
            || policy.is_some_and(|p| p != value.policy.as_ref())
        {
            return Err("incompatiblePricePolicy".into());
        }
        policy = Some(&value.policy);
        if !["priced", "partial", "unknown"].contains(&value.status.as_ref()) {
            return Err("invalidPriceStatus".into());
        }
        let amount = parse_amount(&value.known_cost)?;
        if (value.status.as_ref() == "priced"
            && value.cost.as_deref().map(parse_amount).transpose()? != Some(amount))
            || (value.status.as_ref() != "priced" && value.cost.is_some())
            || (value.status.as_ref() == "unknown" && amount != Decimal::ZERO)
        {
            return Err("inconsistentPriceResult".into());
        }
        total = add_exact(total, amount)?;
        complete &= value.status.as_ref() == "priced";
        known |= value.status.as_ref() != "unknown";
        basis.extend(value.basis.iter().cloned().map(|mut entry| {
            entry.request_input_tokens = None;
            entry
        }));
        issues.extend(value.issues.iter().cloned());
        revisions.insert(value.price_revision.clone());
        for component in &value.components {
            let index = CATEGORIES
                .iter()
                .position(|c| *c == component.category.as_ref())
                .ok_or("invalidPriceCategory")?;
            components[index].push(component);
        }
    }
    for (index, values) in components.iter().enumerate() {
        if values.is_empty() {
            continue;
        }
        let mut amount = Decimal::ZERO;
        let mut count = Some(0_u64);
        let mut priced = true;
        let mut any = false;
        let mut rates = BTreeSet::new();
        for value in values {
            amount = add_exact(amount, parse_amount(&value.known_cost)?)?;
            count = match (count, value.tokens) {
                (Some(left), Some(right)) => {
                    Some(left.checked_add(right).ok_or("tokenCountOverflow")?)
                }
                _ => None,
            };
            priced &= value.status.as_ref() == "priced";
            any |= value.status.as_ref() != "unknown";
            rates.insert(value.rate_per_million.clone());
        }
        result.components.push(PriceComponent {
            category: CATEGORIES[index].into(),
            tokens: count,
            cost: priced.then(|| decimal_string(amount)),
            known_cost: decimal_string(amount),
            status: status(priced, any).into(),
            rate_per_million: if rates.len() == 1 {
                rates.into_iter().next().flatten()
            } else {
                None
            },
        });
    }
    result.cost = complete.then(|| decimal_string(total));
    result.known_cost = decimal_string(total);
    result.status = status(complete, known).into();
    result.basis = basis.into_iter().collect();
    if let Some(policy) = policy {
        result.policy = policy.into();
    }
    result.issues = issues.into_iter().collect();
    if revisions.len() == 1 {
        result.price_revision = revisions.into_iter().next().unwrap();
    } else if revisions.len() > 1 {
        result.price_revision = "mixed".into();
    }
    Ok(result)
}

#[cfg(test)]
#[path = "pricing/tests.rs"]
mod tests;

/// Shares repeated descriptive price strings within a published generation.
/// Amounts and request-specific counts remain independent and exact.
#[derive(Default)]
pub(crate) struct PriceStrings(BTreeSet<Arc<str>>);
impl PriceStrings {
    fn share(&mut self, value: &mut Arc<str>) {
        if let Some(shared) = self.0.get(value.as_ref()) {
            *value = Arc::clone(shared);
        } else {
            self.0.insert(Arc::clone(value));
        }
    }
    pub(crate) fn compact(&mut self, price: &mut PriceResult) {
        for value in [
            &mut price.currency,
            &mut price.policy,
            &mut price.price_revision,
            &mut price.status,
        ] {
            self.share(value);
        }
        for value in &mut price.issues {
            self.share(value);
        }
        for component in &mut price.components {
            self.share(&mut component.category);
            self.share(&mut component.status);
            if let Some(value) = &mut component.rate_per_million {
                self.share(value);
            }
        }
        for basis in &mut price.basis {
            for value in [
                &mut basis.original_model,
                &mut basis.pricing_model,
                &mut basis.model_provider,
                &mut basis.match_method,
                &mut basis.source,
                &mut basis.verified_at,
                &mut basis.price_revision,
                &mut basis.catalog_hash,
                &mut basis.condition,
            ] {
                self.share(value);
            }
            if let Some(value) = &mut basis.api_provider {
                self.share(value);
            }
        }
    }
}
