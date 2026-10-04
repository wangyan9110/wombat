//! A fork retains upstream turn/call identities; merge replays into their oldest recorded ancestor.
use super::*;
fn native(op: &Operation) -> Option<&str> {
    op.call_id.as_deref().or(op.item_id.as_deref())
}
impl Facts {
    pub(in crate::adapters::codex) fn remove_inherited_operations(
        &mut self,
        forest: &ancestry::ForkForest<'_>,
        report: &mut SourceReport,
    ) {
        let mut replay: Vec<_> = forest
            .replays(self.operations.values().filter_map(|op| {
                let turn = self.turns.get(op.turn_id.as_deref()?)?;
                Some((
                    (turn.upstream_id.as_str(), native(op)?),
                    op.thread_id.as_ref(),
                    op.id.as_str(),
                ))
            }))
            .into_iter()
            .map(|(id, ancestor)| (ancestor.to_owned(), id.to_owned()))
            .collect();
        replay.sort_unstable();
        let mut remaining = replay.as_slice();
        while let Some((ancestor, _)) = remaining.first() {
            let count = remaining.partition_point(|(owner, _)| owner == ancestor);
            let (group, rest) = remaining.split_at(count);
            remaining = rest;
            let Some(parent) = self.operations.remove(ancestor) else {
                continue;
            };
            let mut parent = Arc::unwrap_or_clone(parent);
            for (_, id) in group {
                let Some(child) = self.operations.remove(id) else {
                    continue;
                };
                let mut observed = Arc::unwrap_or_clone(child);
                observed.id.clone_from(&parent.id);
                observed.thread_id.clone_from(&parent.thread_id);
                observed.turn_id.clone_from(&parent.turn_id);
                self.observe_operation(&observed);
                merge_metadata(&mut parent, &mut observed, report);
                parent.evidence.extend(observed.evidence);
            }
            // Batch once per owner; Vec::contains on a growing replay list is quadratic.
            parent
                .evidence
                .sort_unstable_by(|a, b| (&a.file, a.line).cmp(&(&b.file, b.line)));
            parent.evidence.dedup();
            // This is a disposable projection. Parsed facts and their native aliases stay untouched.
            self.operations.insert(ancestor.clone(), Arc::new(parent));
        }
    }
}
