//! Reuse equal pricing inputs within one catalog, without merging ledger facts.
use super::*;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

const CAPACITY: usize = 4096;
type Entry = (Arc<Measurement>, Arc<PriceResult>);
pub(super) struct PricePool<'a> {
    prices: &'a crate::pricing_sync::Response,
    entries: HashMap<u64, Vec<Entry>>,
    count: usize,
    strings: pricing::PriceParts,
}
fn key(fact: &Measurement) -> u64 {
    let mut hash = DefaultHasher::new();
    fact.model.hash(&mut hash);
    fact.tokens.hash(&mut hash);
    fact.request_scoped.hash(&mut hash);
    fact.pricing_context_conflict.hash(&mut hash);
    hash.finish()
}
fn same(a: &Measurement, b: &Measurement) -> bool {
    a.model == b.model
        && a.tokens == b.tokens
        && a.request_scoped == b.request_scoped
        && a.pricing_context_conflict == b.pricing_context_conflict
}
impl<'a> PricePool<'a> {
    pub(super) fn new(prices: &'a crate::pricing_sync::Response) -> Self {
        Self {
            prices,
            entries: HashMap::new(),
            count: 0,
            strings: pricing::PriceParts::default(),
        }
    }
    pub(super) fn remember(&mut self, fact: &Arc<Measurement>, price: &Arc<PriceResult>) {
        if self.count >= CAPACITY {
            return;
        }
        let values = self.entries.entry(key(fact)).or_default();
        if values.iter().any(|(f, _)| same(f, fact)) {
            return;
        }
        values.push((Arc::clone(fact), Arc::clone(price)));
        self.count += 1;
    }
    pub(super) fn price(&mut self, fact: &Arc<Measurement>) -> Arc<PriceResult> {
        if let Some((_, price)) = self
            .entries
            .get(&key(fact))
            .into_iter()
            .flatten()
            .find(|(f, _)| same(f, fact))
        {
            return Arc::clone(price);
        }
        let mut price = pricing::price_with_catalog(
            &fact.model,
            &fact.tokens,
            &PricingContext {
                request_scoped: fact.request_scoped,
                model_conflicted: fact.pricing_context_conflict,
            },
            &self.prices.catalog,
            &self.prices.catalog_hash,
        );
        self.strings.compact(&mut price);
        let price = Arc::new(price);
        self.remember(fact, &price);
        price
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fact() -> Arc<Measurement> {
        Arc::new(serde_json::from_value(serde_json::json!({"id":"a","agentKind":"test","sourceInstanceId":"s","grain":"response","timePrecision":"unknown","model":{"raw":"gpt-5.4","provider":"openai"},"tokens":{"input":100,"cacheRead":0,"cacheCreate":0,"output":10,"rawInput":100,"total":110},"tokenUnavailableReasons":{"input":null,"cacheRead":null,"cacheCreate":null,"output":null,"reasoning":"missing","total":null,"rawInput":null},"requestScoped":true,"pricingContextConflict":false,"sequence":0,"evidence":[]})).unwrap())
    }
    #[test]
    fn hash_collisions_and_full_pool_never_substitute_another_price() {
        let root = tempfile::tempdir().unwrap();
        let prices = crate::pricing_sync::current_at(root.path()).unwrap();
        let fact = fact();
        let mut pool = PricePool::new(&prices);
        let a = pool.price(&fact);
        let mut changed = fact.as_ref().clone();
        changed.tokens.input = Some(200);
        changed.tokens.raw_input = Some(200);
        changed.tokens.total = Some(210);
        let changed = Arc::new(changed);
        pool.entries
            .insert(key(&changed), vec![(fact.clone(), a.clone())]);
        pool.count = CAPACITY;
        let b = pool.price(&changed);
        assert!(!Arc::ptr_eq(&a, &b));
        assert_eq!(a.cost.as_deref(), Some("0.0004"));
        assert_eq!(b.cost.as_deref(), Some("0.00065"));
        assert_eq!(pool.count, CAPACITY);
        assert_eq!(pool.entries[&key(&changed)].len(), 1);
    }

    #[test]
    fn model_conflict_observations_isolate_prices_even_under_a_hash_collision() {
        let root = tempfile::tempdir().unwrap();
        let prices = crate::pricing_sync::current_at(root.path()).unwrap();
        let clean = fact();
        let mut conflicted = clean.as_ref().clone();
        conflicted.pricing_context_conflict = true;
        let conflicted = Arc::new(conflicted);
        assert!(!same(&clean, &conflicted));
        assert_ne!(key(&clean), key(&conflicted));
        for (first, second) in [(&clean, &conflicted), (&conflicted, &clean)] {
            let mut pool = PricePool::new(&prices);
            let initial = pool.price(first);
            // Force the collision path, where equality must include observation
            // facts even if the source model label and all counters are identical.
            pool.entries
                .insert(key(second), vec![(Arc::clone(first), Arc::clone(&initial))]);
            let next = pool.price(second);
            assert!(!Arc::ptr_eq(&initial, &next));
            let clean_price = pool.price(&clean);
            let conflict_price = pool.price(&conflicted);
            assert_eq!(clean_price.cost.as_deref(), Some("0.0004"));
            assert_eq!(conflict_price.cost, None);
            assert!(
                conflict_price
                    .issues
                    .iter()
                    .any(|i| i.as_ref() == "modelContextConflict")
            );
            assert!(
                !conflict_price
                    .issues
                    .iter()
                    .any(|i| i.as_ref() == "catalogPriceMissing")
            );
            assert_eq!(clean.model, conflicted.model);
            assert_eq!(clean.tokens, conflicted.tokens);
            assert!(Arc::ptr_eq(&pool.price(&clean), &clean_price));
            assert!(Arc::ptr_eq(&pool.price(&conflicted), &conflict_price));
        }
    }
}
