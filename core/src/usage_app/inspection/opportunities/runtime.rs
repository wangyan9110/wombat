use super::*;
type CallKey = (Option<String>, String);
type Replies<'a> = BTreeMap<CallKey, Vec<(&'a Event, &'a R)>>;
impl Builder {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn runtime(
        &mut self,
        s: &Snapshot,
        scope: &Scope,
        t: &crate::usage_store::ThreadEntry,
        ops: &[Operation],
        targets: &BTreeMap<String, Vec<ReadMatchTarget>>,
        events: &[&Arc<Event>],
        tz: Tz,
    ) -> Result<()> {
        let mut seen = BTreeSet::new();
        let mut reads = BTreeMap::new();
        let poll_states = poll_states(events);
        let by_call: BTreeMap<_, _> = ops
            .iter()
            .filter_map(|o| {
                o.call_id
                    .as_ref()
                    .map(|id| ((o.turn_id.as_deref().map(str::to_owned), id.clone()), o))
            })
            .collect();
        let operations: BTreeMap<_, _> = ops.iter().map(|op| (op.id.as_str(), op)).collect();
        let mut risky: BTreeMap<String, Vec<InspectionEvidence>> = BTreeMap::new();
        let mut requests: BTreeMap<(Option<String>, String), (&Event, &R)> = BTreeMap::new();
        let mut replies: Replies<'_> = BTreeMap::new();
        let mut request_conflicts = BTreeSet::new();
        for event in events {
            let e = event.as_ref();
            if !e.gaps().is_empty() {
                reads.clear();
                for rule in [
                    Rule::SensitiveOutbound,
                    Rule::LongInteraction,
                    Rule::FrequentPolling,
                ] {
                    self.gap(rule, G::SourcePartial);
                }
            }
            if let Payload::Operation { value, .. } = e.payload()
                && targets.contains_key(&value.id)
            {
                for target in &targets[&value.id] {
                    if sensitive(&target.path) {
                        reads.insert(read_key(e, target), e);
                    }
                }
            }
            let Payload::Review { observation } = e.payload() else {
                continue;
            };
            match observation {
                R::Safety {
                    operation_id,
                    request_key,
                    labels,
                    outbound_targets,
                    complete,
                } => {
                    let op = operation_id
                        .as_deref()
                        .and_then(|id| operations.get(id).copied());
                    if operation_id.is_some() && op.is_none() {
                        continue;
                    }
                    if !*complete {
                        self.gap(Rule::RiskyCommand, G::RuntimeCoverage);
                        self.gap(Rule::SecretExposure, G::RuntimeCoverage);
                    }
                    let proof = evidence(
                        s,
                        scope,
                        &t.thread.id,
                        e.turn_id(),
                        op.map(|o| o.id.as_str()),
                    );
                    let identity = operation_id.clone().unwrap_or_else(|| e.id().into());
                    let risks: Vec<_> = labels
                        .iter()
                        .copied()
                        .filter(|l| *l != L::PossibleCredential)
                        .collect();
                    if !risks.is_empty()
                        && seen.insert((identity.clone(), Rule::RiskyCommand, String::new()))
                    {
                        self.add(
                            Rule::RiskyCommand,
                            op.map(|o| o.name.to_string()),
                            vec![count(M::Operations, 1)],
                            vec![proof.clone()],
                            vec![],
                        );
                        if op.is_some_and(|o| inspection_outcomes(o).rejected > 0)
                            && let Some(key) = request_key
                        {
                            risky.entry(key.clone()).or_default().push(proof.clone());
                        }
                    }
                    if !risks.is_empty()
                        && let Some(f) = self
                            .checks
                            .get_mut(&Rule::RiskyCommand)
                            .unwrap()
                            .findings
                            .iter_mut()
                            .find(|f| {
                                f.evidence.first().is_some_and(|p| {
                                    p.operation_id == proof.operation_id
                                        && p.thread_id == proof.thread_id
                                })
                            })
                    {
                        for label in risks {
                            if !f.safety_labels.contains(&label) {
                                f.safety_labels.push(label);
                            }
                        }
                    }
                    if labels.contains(&L::PossibleCredential)
                        && seen.insert((identity.clone(), Rule::SecretExposure, String::new()))
                    {
                        let retained = self.checks[&Rule::SecretExposure].findings.len() < LIMIT;
                        self.add(
                            Rule::SecretExposure,
                            None,
                            vec![count(
                                if op.is_some() {
                                    M::Operations
                                } else {
                                    M::Samples
                                },
                                1,
                            )],
                            vec![proof.clone()],
                            vec![],
                        );
                        if retained
                            && operation_id.is_none()
                            && let Some(f) = self
                                .checks
                                .get_mut(&Rule::SecretExposure)
                                .unwrap()
                                .findings
                                .last_mut()
                            && f.evidence.first().is_some_and(|p| {
                                p.thread_id == proof.thread_id
                                    && p.turn_id == proof.turn_id
                                    && p.operation_id == proof.operation_id
                            })
                        {
                            f.id = crate::hash(
                                serde_json::to_vec(&(Rule::SecretExposure, e.id())).unwrap(),
                            );
                        }
                    }
                    for target in outbound_targets {
                        if !seen.insert((
                            identity.clone(),
                            Rule::SensitiveOutbound,
                            target.path.clone(),
                        )) {
                            continue;
                        }
                        self.observed(Rule::SensitiveOutbound);
                        if let Some(before) = reads.get(&read_key(e, target)).filter(|before| {
                            ordered(before, e)
                                && interval(before, e)
                                    .is_some_and(|ms| ms <= self.policy.outbound_window_ms)
                        }) {
                            self.add(
                                Rule::SensitiveOutbound,
                                Some(target.path.clone()),
                                vec![metric(M::IntervalMs, interval(before, e), U::Milliseconds)],
                                vec![
                                    evidence(s, scope, &t.thread.id, before.turn_id(), None),
                                    proof.clone(),
                                ],
                                vec![],
                            );
                        }
                    }
                }
                R::Question { call_id, .. }
                | R::Permission { call_id }
                | R::Poll { call_id, .. } => {
                    let key = (e.turn_id().map(str::to_owned), call_id.clone());
                    match requests.entry(key.clone()) {
                        std::collections::btree_map::Entry::Vacant(slot) => {
                            slot.insert((e, observation));
                        }
                        std::collections::btree_map::Entry::Occupied(slot) => {
                            if slot.get().1 != observation {
                                request_conflicts.insert(key);
                            }
                        }
                    }
                }
                R::Reply { call_id, .. } => {
                    replies
                        .entry((e.turn_id().map(str::to_owned), call_id.clone()))
                        .or_default()
                        .push((e, observation));
                }
            }
        }
        for rows in risky.into_values() {
            self.observed(Rule::RepeatedRiskyDecline);
            if rows.len() >= self.policy.minimum_risky_declines {
                self.add(
                    Rule::RepeatedRiskyDecline,
                    None,
                    vec![count(M::Requests, rows.len())],
                    rows.into_iter().take(3).collect(),
                    vec![],
                );
            }
        }
        let permissions = requests
            .values()
            .filter(|(_, r)| matches!(r, R::Permission { .. }))
            .count();
        if permissions > 0 {
            // Explicit request_permissions calls only, not all approval prompts.
            let share = if ops.is_empty() {
                None
            } else {
                Some(permissions as f64 / ops.len() as f64)
            };
            if permissions >= self.policy.minimum_permission_requests
                && share.is_some_and(|v| v >= self.policy.permission_request_share)
            {
                self.add(
                    Rule::PermissionFriction,
                    Some(t.thread.id.clone()),
                    vec![
                        count(M::Requests, permissions),
                        count(M::Operations, ops.len()),
                        metric(M::Share, share, U::Ratio),
                    ],
                    vec![evidence(s, scope, &t.thread.id, None, None)],
                    vec![],
                );
            }
        }
        let mut polls: BTreeMap<String, Vec<(&Event, &Event)>> = BTreeMap::new();
        for (key, (request, r)) in requests {
            if request_conflicts.contains(&key) {
                self.gap(Rule::UnansweredQuestion, G::InteractionAssociation);
                continue;
            }
            let reply = replies.get(&key).and_then(|r| {
                r.first()
                    .filter(|first| r.iter().all(|other| first.1 == other.1))
            });
            let Some((
                response,
                R::Reply {
                    answered_ids,
                    empty_output,
                    ..
                },
            )) = reply
            else {
                for rule in [
                    Rule::UnansweredQuestion,
                    Rule::LongInteraction,
                    Rule::FrequentPolling,
                ] {
                    self.gap(rule, G::InteractionAssociation);
                }
                continue;
            };
            if !same_segment(request, response) || !ordered(request, response) {
                continue;
            }
            let op = by_call.get(&key).copied();
            let proof = evidence(
                s,
                scope,
                &t.thread.id,
                request.turn_id(),
                op.map(|o| o.id.as_str()),
            );
            if let R::Question { question_ids, .. } = r
                && let Some(answered) = answered_ids
            {
                self.observed(Rule::UnansweredQuestion);
                let missing = question_ids
                    .iter()
                    .filter(|id| !answered.contains(id))
                    .count();
                if missing > 0 {
                    self.add(
                        Rule::UnansweredQuestion,
                        Some(t.thread.id.clone()),
                        vec![
                            count(M::Unanswered, missing),
                            count(M::Requests, question_ids.len()),
                        ],
                        vec![proof.clone()],
                        vec![],
                    );
                }
            }
            if matches!(r, R::Question { .. } | R::Permission { .. })
                && let Some(ms) = interval(request, response)
            {
                self.observed(Rule::LongInteraction);
                if ms >= self.policy.long_interaction_ms {
                    self.add(
                        Rule::LongInteraction,
                        Some(t.thread.id.clone()),
                        vec![metric(M::IntervalMs, Some(ms), U::Milliseconds)],
                        vec![proof.clone()],
                        vec![],
                    );
                }
            }
            if let R::Poll {
                process_key,
                empty_input: true,
                wait_ms,
                ..
            } = r
                && *wait_ms <= self.policy.maximum_poll_wait_ms
                && *empty_output == Some(true)
            {
                self.observed(Rule::FrequentPolling);
                polls
                    .entry(process_key.clone())
                    .or_default()
                    .push((request, response));
            }
        }
        for requests in polls.values_mut() {
            requests.sort_by_key(|(e, _)| (e.position().byte_offset, e.position().ordinal));
            let mut chain = 0;
            let mut previous: Option<&Event> = None;
            for (request, response) in requests {
                let state = poll_states.get(request.id());
                if state.is_none_or(|state| !state.0) {
                    chain = 0;
                    previous = None;
                    continue;
                }
                let continuous = previous.is_some_and(|p| {
                    same_segment(p, request)
                        && ordered(p, request)
                        && interval(p, request)
                            .is_some_and(|ms| ms <= self.policy.maximum_poll_wait_ms)
                        && poll_states
                            .get(p.id())
                            .zip(state)
                            .is_some_and(|(a, b)| a.1 == b.1 && a.2 == b.2)
                });
                chain = if continuous { chain + 1 } else { 1 };
                previous = Some(response);
                if chain == self.policy.minimum_polls {
                    let at = request
                        .time()
                        .timestamp
                        .as_deref()
                        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                        .map(|a| a.with_timezone(&tz).date_naive().to_string());
                    if let Some(day) = at {
                        self.polling.push((
                            t.thread.id.clone(),
                            day,
                            evidence(s, scope, &t.thread.id, request.turn_id(), None),
                            chain,
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}
fn same_segment(a: &Event, b: &Event) -> bool {
    a.turn_id().is_some()
        && a.thread_id() == b.thread_id()
        && a.turn_id() == b.turn_id()
        && a.position().file_id == b.position().file_id
        && a.position().generation == b.position().generation
}
fn ordered(a: &Event, b: &Event) -> bool {
    (a.position().byte_offset, a.position().ordinal)
        < (b.position().byte_offset, b.position().ordinal)
}
fn interval(a: &Event, b: &Event) -> Option<u64> {
    let a = DateTime::parse_from_rfc3339(a.time().timestamp.as_deref()?).ok()?;
    let b = DateTime::parse_from_rfc3339(b.time().timestamp.as_deref()?).ok()?;
    u64::try_from((b - a).num_milliseconds())
        .ok()
        .filter(|v| *v <= MAX_SAFE_INTEGER)
}

fn read_key(event: &Event, target: &ReadMatchTarget) -> (String, String, Option<String>, String) {
    let path = if target.platform == SourcePathPlatform::Windows {
        format!("windows:{}", target.path.to_ascii_lowercase())
    } else {
        format!("posix:{}", target.path)
    };
    (
        event.position().file_id.to_string(),
        event.position().generation.to_string(),
        event.turn_id().map(str::to_owned),
        path,
    )
}
// One linear pass records native running boundaries and interruptions for polling chains.
pub(super) fn poll_states(events: &[&Arc<Event>]) -> BTreeMap<String, (bool, u64, u64)> {
    let mut states = BTreeMap::new();
    let mut active = BTreeMap::new();
    let mut epoch = 0;
    let mut process_epochs = BTreeMap::<String, u64>::new();
    let mut calls = BTreeMap::new();
    for event in events {
        let e = event.as_ref();
        let segment = (
            e.position().file_id.to_string(),
            e.position().generation.to_string(),
            e.turn_id().map(str::to_owned),
        );
        if !e.gaps().is_empty()
            || matches!(
                e.payload(),
                Payload::Message {
                    origin: MessageOrigin::UserUnclassified,
                    ..
                }
            )
        {
            epoch += 1;
        }
        if let Payload::Lifecycle {
            lifecycle: LifecycleKind::Turn,
            phase,
            ..
        } = e.payload()
        {
            active.insert(
                segment.clone(),
                matches!(
                    phase,
                    crate::session_events::Phase::Started | crate::session_events::Phase::Progress
                ),
            );
        }
        match e.payload() {
            Payload::Review {
                observation:
                    R::Poll {
                        call_id,
                        process_key,
                        empty_input,
                        ..
                    },
            } => {
                if !empty_input {
                    *process_epochs.entry(process_key.clone()).or_default() += 1;
                }
                calls.insert(
                    (e.turn_id().map(str::to_owned), call_id.clone()),
                    process_key.clone(),
                );
                states.insert(
                    e.id().into(),
                    (
                        *active.get(&segment).unwrap_or(&false),
                        epoch,
                        *process_epochs.get(process_key).unwrap_or(&0),
                    ),
                );
            }
            Payload::Review {
                observation:
                    R::Reply {
                        call_id,
                        empty_output,
                        ..
                    },
            } => {
                if let Some(key) = calls.get(&(e.turn_id().map(str::to_owned), call_id.clone())) {
                    if *empty_output != Some(true) {
                        *process_epochs.entry(key.clone()).or_default() += 1;
                    }
                    states.insert(
                        e.id().into(),
                        (
                            *active.get(&segment).unwrap_or(&false),
                            epoch,
                            *process_epochs.get(key).unwrap_or(&0),
                        ),
                    );
                }
            }
            _ => {}
        }
    }
    states
}
