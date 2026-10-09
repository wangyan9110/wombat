use super::*;
impl Builder {
    pub(super) fn cost(
        &mut self,
        s: &Snapshot,
        scope: &Scope,
        rows: &[&PricedMeasurement],
        baseline: Option<(&Scope, &[&PricedMeasurement])>,
    ) -> Result<()> {
        let policy = self.policy.clone();
        let summary = summarize(rows)?;
        if rows.is_empty() {
            for r in [
                Rule::UnpricedUsage,
                Rule::EstimateConcentration,
                Rule::EstimateOutlier,
                Rule::CacheCreationReuse,
                Rule::ModelReview,
            ] {
                self.gap(r, G::NoObservations);
            }
        }
        let mut models: BTreeMap<Option<String>, Vec<&PricedMeasurement>> = BTreeMap::new();
        let mut projects: BTreeMap<Option<String>, Vec<&PricedMeasurement>> = BTreeMap::new();
        let mut tasks: BTreeMap<String, Vec<&PricedMeasurement>> = BTreeMap::new();
        let project_by_thread: BTreeMap<_, _> = s
            .manifest
            .threads
            .iter()
            .map(|t| (t.thread.id.as_str(), t.thread.project.clone()))
            .collect();
        for row in rows {
            models
                .entry(row.fact.model.raw.as_deref().map(str::to_owned))
                .or_default()
                .push(row);
            let project = row
                .fact
                .thread_id
                .as_deref()
                .and_then(|id| project_by_thread.get(id))
                .cloned()
                .flatten();
            projects.entry(project).or_default().push(row);
            if let Some(id) = row.fact.thread_id.as_deref() {
                tasks.entry(id.into()).or_default().push(row);
            }
        }
        for (model, rows) in &models {
            match unpriced_tokens(rows)? {
                Some(n) if n >= policy.minimum_unpriced_tokens => self.add(
                    Rule::UnpricedUsage,
                    model.clone(),
                    vec![metric(M::UnpricedTokens, Some(n), U::Token)],
                    proofs(s, scope, rows),
                    vec![],
                ),
                None => self.gap(Rule::UnpricedUsage, G::IncompletePrices),
                _ => {}
            }
        }
        let minimum: Decimal = policy.minimum_amount_usd.parse().unwrap();
        let total = amount(&summary);
        if total.is_none() && !rows.is_empty() {
            for r in [
                Rule::EstimateConcentration,
                Rule::EstimateOutlier,
                Rule::ModelReview,
            ] {
                self.gap(r, G::IncompletePrices);
            }
        }
        let mut task_amounts = Vec::new();
        for (id, rows) in &tasks {
            if let Some(cost) = amount(&summarize(rows)?) {
                task_amounts.push((id, cost, rows));
            }
        }
        task_amounts.sort_by_key(|(_, n, _)| *n);
        if task_amounts.len() >= policy.minimum_outlier_tasks {
            let middle = task_amounts.len() / 2;
            let median = if task_amounts.len() % 2 == 0 {
                (task_amounts[middle - 1].1 + task_amounts[middle].1) / Decimal::from(2)
            } else {
                task_amounts[middle].1
            };
            for (id, cost, rows) in task_amounts.iter().rev() {
                if *cost >= minimum
                    && *cost >= median * Decimal::from_f64_retain(policy.outlier_multiple).unwrap()
                {
                    self.add(
                        Rule::EstimateOutlier,
                        Some((*id).clone()),
                        vec![
                            metric(M::Amount, Some(cost.normalize()), U::Usd),
                            metric(
                                M::Multiple,
                                (median > Decimal::ZERO).then(|| *cost / median),
                                U::Factor,
                            ),
                            count(M::Samples, task_amounts.len()),
                        ],
                        proofs(s, scope, rows),
                        vec![],
                    );
                }
            }
        } else {
            self.gap(Rule::EstimateOutlier, G::NoObservations);
        }
        if let Some(total) = total.filter(|n| *n >= minimum) {
            if projects.len() >= 2 {
                for (project, rows) in projects {
                    if let Some(cost) = amount(&summarize(&rows)?)
                        && let Some(share) = (cost / total).to_f64()
                        && share >= policy.concentration_share
                    {
                        self.add(
                            Rule::EstimateConcentration,
                            project,
                            vec![
                                metric(M::Amount, Some(cost.normalize()), U::Usd),
                                metric(M::Share, Some(share), U::Ratio),
                            ],
                            proofs(s, scope, &rows),
                            vec![],
                        );
                    }
                }
            }
            for (model, rows) in &models {
                let Some(cost) = amount(&summarize(rows)?) else {
                    continue;
                };
                let Some(share) = (cost / total).to_f64().filter(|v| *v >= policy.model_share)
                else {
                    continue;
                };
                let ids: BTreeSet<_> = rows
                    .iter()
                    .filter_map(|r| r.fact.thread_id.as_deref())
                    .collect();
                if ids.len() < policy.minimum_model_tasks {
                    self.gap(Rule::ModelReview, G::NoObservations);
                    continue;
                }
                self.model_tasks.insert(
                    model.clone(),
                    ids.iter().map(|id| (*id).to_owned()).collect(),
                );
                let proof = proofs(s, scope, rows);
                // Operation counts are filled by the existing per-task pass, never inferred from tokens.
                self.add(
                    Rule::ModelReview,
                    model.clone(),
                    vec![
                        metric(M::Amount, Some(cost.normalize()), U::Usd),
                        metric(M::Share, Some(share), U::Ratio),
                        count(M::Tasks, ids.len()),
                    ],
                    proof,
                    vec![],
                );
            }
        }
        for (model, rows) in &models {
            let summary = summarize(rows)?;
            match summary.tokens.cache_create.zip(summary.tokens.cache_read) {
                Some((created, read)) if created >= policy.minimum_cache_created => {
                    let ratio = read as f64 / created as f64;
                    if ratio <= policy.maximum_read_create_ratio {
                        self.add(
                            Rule::CacheCreationReuse,
                            model.clone(),
                            vec![
                                metric(M::CacheCreated, Some(created), U::Token),
                                metric(M::CacheRead, Some(read), U::Token),
                                metric(M::ReadCreateRatio, Some(ratio), U::Ratio),
                            ],
                            proofs(s, scope, rows),
                            vec![],
                        );
                    }
                }
                None => self.gap(Rule::CacheCreationReuse, G::UnknownCache),
                _ => {}
            }
        }
        if let Some((before_scope, before_rows)) = baseline {
            let before = summarize(before_rows)?;
            if let Some((a, b)) = amount(&before)
                .zip(total)
                .filter(|_| !before_rows.is_empty() && !rows.is_empty())
            {
                if b >= a * Decimal::from_f64_retain(policy.increase_multiple).unwrap()
                    && b - a >= policy.minimum_increase_usd.parse::<Decimal>().unwrap()
                {
                    self.add(
                        Rule::EstimateIncrease,
                        None,
                        vec![
                            metric(M::Amount, Some(b.normalize()), U::Usd),
                            metric(M::BaselineAmount, Some(a.normalize()), U::Usd),
                            metric(M::Multiple, (a > Decimal::ZERO).then(|| b / a), U::Factor),
                        ],
                        proofs(s, scope, rows),
                        proofs(s, before_scope, before_rows),
                    );
                }
            } else {
                self.gap(
                    Rule::EstimateIncrease,
                    if before_rows.is_empty() {
                        G::NoObservations
                    } else {
                        G::IncompletePrices
                    },
                );
            }
        } else {
            self.gap(Rule::EstimateIncrease, G::NoBaseline);
        }
        Ok(())
    }
}
