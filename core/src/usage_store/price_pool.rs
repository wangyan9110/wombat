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
    hash.finish()
}
fn same(a: &Measurement, b: &Measurement) -> bool {
    a.model == b.model && a.tokens == b.tokens && a.request_scoped == b.request_scoped
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
    #[test]
    fn hash_collisions_and_full_pool_never_substitute_another_price() {
        let root = tempfile::tempdir().unwrap();
        let prices = crate::pricing_sync::current_at(root.path()).unwrap();
        let fact: Arc<Measurement> = Arc::new(serde_json::from_value(serde_json::json!({"id":"a","agentKind":"test","sourceInstanceId":"s","grain":"response","timePrecision":"unknown","model":{"raw":"gpt-5.4","provider":"openai"},"tokens":{"input":100,"cacheRead":0,"cacheCreate":0,"output":10,"rawInput":100,"total":110},"requestScoped":true,"sequence":0,"evidence":[]})).unwrap());
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
}
