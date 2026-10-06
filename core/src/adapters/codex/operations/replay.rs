//! A fork retains upstream turn/call identities; merge replays into their oldest recorded ancestor.
use super::*;
impl Facts {
    pub(in crate::adapters::codex) fn remove_inherited_operations(
        &mut self,
        forest: &ancestry::ForkForest<'_>,
        report: &mut SourceReport,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> anyhow::Result<()> {
        let check = crate::operation_association::check;
        check(cancelled)?;
        let mut entries = Vec::new();
        for op in self.operations.values() {
            check(cancelled)?;
            let turn = op.turn_id.as_deref().and_then(|id| self.turns.get(id));
            if let Some(turn) = turn
                && let Some(aliases) = self.operation_aliases.get(&op.id)
            {
                for alias in aliases.iter() {
                    check(cancelled)?;
                    entries.push((
                        (turn.upstream_id.as_str(), alias),
                        op.thread_id.as_ref(),
                        op.id.as_str(),
                    ));
                }
            }
        }
        // Every edge already proves native ancestry and a typed alias. A late
        // dual-alias observation can join multiple recorded ancestor groups.
        let mut edges = BTreeMap::<&str, BTreeSet<&str>>::new();
        for (id, ancestor) in forest.replays_cancellable(entries.into_iter(), cancelled)? {
            check(cancelled)?;
            edges.entry(id).or_default().insert(ancestor);
            edges.entry(ancestor).or_default().insert(id);
        }
        let mut seen = BTreeSet::new();
        let mut replay = Vec::new();
        for first in edges.keys().copied() {
            check(cancelled)?;
            if seen.contains(first) {
                continue;
            }
            let mut pending = vec![first];
            let mut group = Vec::new();
            while let Some(id) = pending.pop() {
                check(cancelled)?;
                if !seen.insert(id) {
                    continue;
                }
                group.push(id);
                for next in &edges[id] {
                    check(cancelled)?;
                    if !seen.contains(next) {
                        pending.push(next);
                    }
                }
            }
            let key = |id: &str| {
                let operation = &self.operations[id];
                let evidence = operation.evidence.first();
                (
                    forest.owner_order(&operation.thread_id),
                    evidence.map(|e| e.file.as_ref()),
                    evidence.map(|e| e.line),
                    &operation.id,
                )
            };
            let mut owner = first;
            for id in &group {
                check(cancelled)?;
                if key(id) < key(owner) {
                    owner = id;
                }
            }
            for id in group {
                check(cancelled)?;
                if id != owner {
                    replay.push((owner.to_owned(), id.to_owned()));
                }
            }
        }
        check(cancelled)?;
        replay.sort_unstable();
        check(cancelled)?;
        let mut remaining = replay.as_slice();
        while let Some((ancestor, _)) = remaining.first() {
            check(cancelled)?;
            let count = remaining.partition_point(|(owner, _)| owner == ancestor);
            let (group, rest) = remaining.split_at(count);
            remaining = rest;
            let Some(parent) = self.operations.remove(ancestor) else {
                continue;
            };
            let mut parent = Arc::unwrap_or_clone(parent);
            for (_, id) in group {
                check(cancelled)?;
                let Some(child) = self.operations.remove(id) else {
                    continue;
                };
                let mut observed = Arc::unwrap_or_clone(child);
                observed.id.clone_from(&parent.id);
                observed.thread_id.clone_from(&parent.thread_id);
                observed.turn_id.clone_from(&parent.turn_id);
                self.observe_operation(&observed);
                merge_metadata(&mut parent, &mut observed, report);
                for evidence in observed.evidence {
                    check(cancelled)?;
                    parent.evidence.push(evidence);
                }
            }
            // Batch once per owner; Vec::contains on a growing replay list is quadratic.
            check(cancelled)?;
            parent
                .evidence
                .sort_unstable_by(|a, b| (&a.file, a.line).cmp(&(&b.file, b.line)));
            check(cancelled)?;
            parent.evidence.dedup();
            check(cancelled)?;
            // This is a disposable projection. Parsed facts and their native aliases stay untouched.
            self.operations.insert(ancestor.clone(), Arc::new(parent));
        }
        check(cancelled)?;
        Ok(())
    }
}
