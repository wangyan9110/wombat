//! Streaming exact totals retain four category accumulators, not every input reference.
use super::*;

struct ComponentTotal {
    seen: bool,
    amount: Decimal,
    count: Option<u64>,
    priced: bool,
    known: bool,
    rate: Option<Arc<str>>,
    mixed_rate: bool,
}
impl Default for ComponentTotal {
    fn default() -> Self {
        Self {
            seen: false,
            amount: Decimal::ZERO,
            count: Some(0),
            priced: true,
            known: false,
            rate: None,
            mixed_rate: false,
        }
    }
}
impl ComponentTotal {
    fn add(&mut self, value: &PriceComponent) -> Result<(), String> {
        let amount = checked_amount(&value.status, value.cost.as_deref(), &value.known_cost)?;
        self.amount = add_exact(self.amount, amount)?;
        self.count = match (self.count, value.tokens) {
            (Some(left), Some(right)) => Some(left.checked_add(right).ok_or("tokenCountOverflow")?),
            _ => None,
        };
        self.priced &= value.status.as_ref() == "priced";
        self.known |= value.status.as_ref() != "unknown";
        if !self.seen {
            self.rate = value.rate_per_million.clone();
        } else if !self.mixed_rate && self.rate != value.rate_per_million {
            self.mixed_rate = true;
            self.rate = None;
        }
        self.seen = true;
        Ok(())
    }
    fn finish(self, category: &str) -> Option<Arc<PriceComponent>> {
        self.seen.then(|| {
            Arc::new(PriceComponent {
                category: category.into(),
                tokens: self.count,
                cost: self.priced.then(|| decimal_string(self.amount)),
                known_cost: decimal_string(self.amount),
                status: status(self.priced, self.known).into(),
                rate_per_million: self.rate,
            })
        })
    }
}

fn checked_amount(state: &str, cost: Option<&str>, known: &str) -> Result<Decimal, String> {
    if !["priced", "partial", "unknown"].contains(&state) {
        return Err("invalidPriceStatus".into());
    }
    let amount = parse_amount(known)?;
    if (state == "priced" && cost.map(parse_amount).transpose()? != Some(amount))
        || (state != "priced" && cost.is_some())
        || (state == "unknown" && amount != Decimal::ZERO)
    {
        return Err("inconsistentPriceResult".into());
    }
    Ok(amount)
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
    let mut components: [ComponentTotal; 4] = std::array::from_fn(|_| ComponentTotal::default());
    for value in values {
        if value.currency.as_ref() != "USD" || value.policy.as_ref() != PRICE_POLICY {
            return Err("incompatiblePricePolicy".into());
        }
        total = add_exact(
            total,
            checked_amount(&value.status, value.cost.as_deref(), &value.known_cost)?,
        )?;
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
            components[index].add(component)?;
        }
    }
    result.components = components
        .into_iter()
        .zip(CATEGORIES)
        .filter_map(|(sum, category)| sum.finish(category))
        .collect();
    result.cost = complete.then(|| decimal_string(total));
    result.known_cost = decimal_string(total);
    result.status = status(complete, known).into();
    result.basis = basis.into_iter().collect();
    result.issues = issues.into_iter().collect();
    if revisions.len() == 1 {
        result.price_revision = revisions.into_iter().next().unwrap();
    } else if revisions.len() > 1 {
        result.price_revision = "mixed".into();
    }
    Ok(result)
}
