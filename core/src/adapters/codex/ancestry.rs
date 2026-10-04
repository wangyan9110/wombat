//! Index explicit fork trees once; cycles and their descendants have no trusted ancestry.
use super::*;

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
    pub(super) fn new(parents: &'a HashMap<String, String>) -> Self {
        let names: BTreeSet<_> = parents
            .iter()
            .flat_map(|(child, parent)| [child.as_str(), parent.as_str()])
            .collect();
        let indexes: BTreeMap<_, _> = names
            .into_iter()
            .enumerate()
            .map(|(n, id)| (id, n))
            .collect();
        let mut children = vec![vec![]; indexes.len()];
        let mut roots = vec![true; indexes.len()];
        for (child, parent) in parents {
            let child = indexes[child.as_str()];
            children[indexes[parent.as_str()]].push(child);
            roots[child] = false;
        }
        // Iterative preorder avoids call-stack growth for long native fork chains.
        let mut ranges: Vec<Option<Interval>> = vec![None; indexes.len()];
        let mut stack = Vec::new();
        let mut clock = 0;
        for root in (0..indexes.len()).filter(|n| roots[*n]) {
            stack.push((root, false));
            while let Some((node, leaving)) = stack.pop() {
                if leaving {
                    ranges[node].as_mut().unwrap().end = clock;
                } else {
                    ranges[node] = Some(Interval {
                        start: clock,
                        end: clock,
                    });
                    clock += 1;
                    stack.push((node, true));
                    stack.extend(children[node].iter().rev().map(|child| (*child, false)));
                }
            }
        }
        let unresolved = ranges.iter().filter(|range| range.is_none()).count();
        let intervals = indexes
            .into_iter()
            .filter_map(|(id, n)| Some((id, ranges[n]?)))
            .collect();
        Self {
            intervals,
            unresolved,
        }
    }

    /// Return replay -> oldest recorded ancestor within each exact evidence identity.
    /// Sorting borrowed identities costs O(E log E); no per-event ancestor walks or text copies.
    pub(super) fn replays<'b, K: Ord>(
        &self,
        entries: impl Iterator<Item = (K, &'b str, &'b str)>,
    ) -> Vec<(&'b str, &'b str)> {
        if self.intervals.is_empty() {
            return Vec::new();
        }
        let mut entries: Vec<_> = entries
            .filter_map(|(key, thread, id)| Some((key, *self.intervals.get(thread)?, id)))
            .collect();
        entries.sort_unstable_by(|a, b| (&a.0, a.1.start, a.2).cmp(&(&b.0, b.1.start, b.2)));
        let mut owner: Option<usize> = None;
        let mut replay = Vec::new();
        for (n, (key, range, id)) in entries.iter().enumerate() {
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
        replay
    }
}
