//! Share equal frozen price parts without merging requests or inferring equal amounts.
use super::*;
use std::collections::HashSet;

const MAX_COMPONENTS: usize = 4096;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_COMPONENT_TEXT: usize = 1024;

#[derive(Default)]
pub(crate) struct PriceParts {
    text: crate::shared_text::SharedText,
    components: HashSet<Arc<PriceComponent>>,
    component_bytes: usize,
}

impl PriceParts {
    pub(crate) fn compact(&mut self, price: &mut PriceResult) {
        for value in [
            &mut price.currency,
            &mut price.policy,
            &mut price.price_revision,
            &mut price.status,
        ] {
            self.text.share(value);
        }
        for value in &mut price.issues {
            self.text.share(value);
        }
        for component in &mut price.components {
            // Published parts already share their text; never clone them merely to compact.
            if let Some(value) = Arc::get_mut(component) {
                self.text.share(&mut value.category);
                self.text.share(&mut value.status);
                if let Some(rate) = &mut value.rate_per_million {
                    self.text.share(rate);
                }
            }
            let bytes = component.category.len()
                + component.status.len()
                + component.cost.as_ref().map_or(0, String::len)
                + component.known_cost.len()
                + component.rate_per_million.as_ref().map_or(0, |s| s.len());
            if bytes > MAX_COMPONENT_TEXT {
                continue;
            }
            if let Some(equal) = self.components.get(component.as_ref()) {
                *component = Arc::clone(equal);
            } else if self.components.len() < MAX_COMPONENTS
                && self.component_bytes + bytes <= MAX_TEXT_BYTES
            {
                self.component_bytes += bytes;
                self.components.insert(Arc::clone(component));
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
                self.text.share(value);
            }
            if let Some(value) = &mut basis.api_provider {
                self.text.share(value);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_component_pools_preserve_distinct_values_and_shared_revisions() {
        for width in [0, 300] {
            let mut pool = PriceParts::default();
            let mut first = empty_price();
            first.components.push(Arc::new(PriceComponent {
                category: "input".into(),
                tokens: Some(1),
                cost: Some("0.0000025".into()),
                known_cost: "0.0000025".into(),
                status: "priced".into(),
                rate_per_million: Some("2.5".into()),
            }));
            pool.compact(&mut first);
            let expected = serde_json::to_value(&first).unwrap();
            for n in 0..5000 {
                let mut next = first.clone();
                let component = Arc::make_mut(&mut next.components[0]);
                component.tokens = Some(n + 2);
                component.category = format!("{n}{}", "x".repeat(width)).into();
                let original = serde_json::to_value(&next).unwrap();
                pool.compact(&mut next);
                assert_eq!(serde_json::to_value(&next).unwrap(), original);
                assert!(!Arc::ptr_eq(&first.components[0], &next.components[0]));
            }
            assert!(pool.components.len() <= MAX_COMPONENTS);
            assert!(pool.component_bytes <= MAX_TEXT_BYTES);
            let mut equal: PriceResult = serde_json::from_value(expected.clone()).unwrap();
            pool.compact(&mut equal);
            assert!(Arc::ptr_eq(&first.components[0], &equal.components[0]));
            Arc::make_mut(&mut equal.components[0]).cost = None;
            pool.compact(&mut equal);
            assert!(equal.components[0].cost.is_none());
            assert_eq!(serde_json::to_value(&first).unwrap(), expected);
            let mut huge = first.clone();
            Arc::make_mut(&mut huge.components[0]).category = "文本".repeat(1024).into();
            let expected = serde_json::to_value(&huge).unwrap();
            let count = pool.components.len();
            pool.compact(&mut huge);
            assert_eq!(serde_json::to_value(&huge).unwrap(), expected);
            assert_eq!(pool.components.len(), count);
        }
    }
}
