//! Index explicit fork trees once; cycles and their descendants have no trusted ancestry.
use super::*;
use crate::operation_association::check;
use std::sync::atomic::AtomicBool;

#[derive(Clone, Copy)]
struct Interval {
    start: usize,
    end: usize,
}

pub(super) struct ForkForest<'a> {
    intervals: BTreeMap<&'a str, Interval>,
    pub(super) unresolved: usize,
}

impl<'a> ForkForest<'a> {
    pub(super) fn owner_order(&self, thread: &str) -> Option<usize> {
        self.intervals.get(thread).map(|interval| interval.start)
    }
    #[cfg(test)]
    pub(super) fn new(parents: &'a HashMap<String, String>) -> Self {
        Self::new_cancellable(parents, &AtomicBool::new(false)).unwrap()
    }
    pub(super) fn new_cancellable(
        parents: &'a HashMap<String, String>,
        cancelled: &AtomicBool,
    ) -> anyhow::Result<Self> {
        check(cancelled)?;
        let mut names = BTreeSet::new();
        for (child, parent) in parents {
            check(cancelled)?;
            names.extend([child.as_str(), parent.as_str()]);
        }
        let mut indexes = BTreeMap::new();
        for (n, id) in names.into_iter().enumerate() {
            check(cancelled)?;
            indexes.insert(id, n);
        }
        let mut children = vec![vec![]; indexes.len()];
        let mut roots = vec![true; indexes.len()];
        for (child, parent) in parents {
            check(cancelled)?;
            let child = indexes[child.as_str()];
            children[indexes[parent.as_str()]].push(child);
            roots[child] = false;
        }
        // Iterative preorder avoids call-stack growth for long native fork chains.
        let mut ranges: Vec<Option<Interval>> = vec![None; indexes.len()];
        let mut stack = Vec::new();
        let mut clock = 0;
        for (root, is_root) in roots.iter().enumerate() {
            check(cancelled)?;
            if !is_root {
                continue;
            }
            stack.push((root, false));
            while let Some((node, leaving)) = stack.pop() {
                check(cancelled)?;
                if leaving {
                    ranges[node].as_mut().unwrap().end = clock;
                } else {
                    ranges[node] = Some(Interval {
                        start: clock,
                        end: clock,
                    });
                    clock += 1;
                    stack.push((node, true));
                    for child in children[node].iter().rev() {
                        check(cancelled)?;
                        stack.push((*child, false));
                    }
                }
            }
        }
        let mut unresolved = 0;
        let mut intervals = BTreeMap::new();
        for (id, n) in indexes {
            check(cancelled)?;
            if let Some(range) = ranges[n] {
                intervals.insert(id, range);
            } else {
                unresolved += 1;
            }
        }
        check(cancelled)?;
        Ok(Self {
            intervals,
            unresolved,
        })
    }

    /// Return replay -> oldest recorded ancestor within each exact evidence identity.
    /// Sorting borrowed identities costs O(E log E); no per-event ancestor walks or text copies.
    #[cfg(test)]
    pub(super) fn replays<'b, K: Ord>(
        &self,
        entries: impl Iterator<Item = (K, &'b str, &'b str)>,
    ) -> Vec<(&'b str, &'b str)> {
        self.replays_cancellable(entries, &AtomicBool::new(false))
            .unwrap()
    }
    /// Sorting remains cooperative: cancellation is checked before and after
    /// the sort, and throughout collection and traversal, not inside comparisons.
    pub(super) fn replays_cancellable<'b, K: Ord>(
        &self,
        entries: impl Iterator<Item = (K, &'b str, &'b str)>,
        cancelled: &AtomicBool,
    ) -> anyhow::Result<Vec<(&'b str, &'b str)>> {
        check(cancelled)?;
        if self.intervals.is_empty() {
            return Ok(Vec::new());
        }
        let mut retained = Vec::new();
        for (key, thread, id) in entries {
            check(cancelled)?;
            if let Some(range) = self.intervals.get(thread) {
                retained.push((key, *range, id));
            }
        }
        let mut entries = retained;
        check(cancelled)?;
        entries.sort_unstable_by(|a, b| (&a.0, a.1.start, a.2).cmp(&(&b.0, b.1.start, b.2)));
        check(cancelled)?;
        let mut owner: Option<usize> = None;
        let mut replay = Vec::new();
        for (n, (key, range, id)) in entries.iter().enumerate() {
            check(cancelled)?;
            if let Some(index) = owner {
                let (prior_key, prior_range, prior_id) = &entries[index];
                if key == prior_key
                    && range.start > prior_range.start
                    && range.start < prior_range.end
                {
                    replay.push((*id, *prior_id));
                    continue;
                }
            }
            owner = Some(n);
        }
        check(cancelled)?;
        Ok(replay)
    }
}
