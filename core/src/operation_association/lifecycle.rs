//! Terminal evidence is independent of identity, clocks, resource changes and accounting.
//! Retain at most two distinct values: further values cannot repair a contradiction.
use super::TerminalOutcome;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TerminalState {
    Unobserved,
    Known(TerminalOutcome),
    Conflicting,
}

/// An immutable result can be shared by projections without replaying source observations.
pub(crate) struct TerminalResult {
    pub state: TerminalState,
    pub exit_code: Option<i64>,
}
impl TerminalResult {
    pub(crate) fn outcome(&self) -> Option<TerminalOutcome> {
        match self.state {
            TerminalState::Known(outcome) => Some(outcome),
            _ => None,
        }
    }
}

struct Distinct<T> {
    first: Option<T>,
    second: Option<T>,
}
impl<T> Default for Distinct<T> {
    fn default() -> Self {
        Self {
            first: None,
            second: None,
        }
    }
}
impl<T: Copy + Eq> Distinct<T> {
    fn observe(&mut self, value: T) -> bool {
        if self.first == Some(value) || self.second == Some(value) {
            return false;
        }
        if self.first.is_none() {
            self.first = Some(value);
            true
        } else if self.second.is_none() {
            self.second = Some(value);
            true
        } else {
            false
        }
    }
}

#[derive(Default)]
pub(crate) struct TerminalEvidence {
    outcomes: Distinct<TerminalOutcome>,
    codes: Distinct<i64>,
    conflict: bool,
}
impl TerminalEvidence {
    pub(crate) fn finish(self) -> TerminalResult {
        TerminalResult {
            state: self.state(),
            exit_code: self.exit_code(),
        }
    }
    /// True only for the first two distinct observations, for bounded evidence witnesses.
    pub(crate) fn observe_outcome(&mut self, outcome: TerminalOutcome) -> bool {
        self.outcomes.observe(outcome)
    }
    /// Callers supply codes only from reliable terminal observations.
    pub(crate) fn observe_code(&mut self, code: i64) -> bool {
        self.codes.observe(code)
    }
    pub(crate) fn mark_conflict(&mut self, conflict: bool) {
        self.conflict |= conflict;
    }
    pub(crate) fn state(&self) -> TerminalState {
        if self.conflict || self.outcomes.second.is_some() || self.codes.second.is_some() {
            TerminalState::Conflicting
        } else if let Some(outcome) = self.outcomes.first {
            TerminalState::Known(outcome)
        } else {
            TerminalState::Unobserved
        }
    }
    #[cfg(test)]
    pub(crate) fn outcome(&self) -> Option<TerminalOutcome> {
        match self.state() {
            TerminalState::Known(outcome) => Some(outcome),
            _ => None,
        }
    }
    pub(crate) fn exit_code(&self) -> Option<i64> {
        (self.state() != TerminalState::Conflicting)
            .then_some(self.codes.first)
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absence_duplicates_and_explicit_conflict_remain_distinct() {
        let mut facts = TerminalEvidence::default();
        assert_eq!(facts.state(), TerminalState::Unobserved);
        assert!(facts.observe_outcome(TerminalOutcome::Completed));
        assert!(!facts.observe_outcome(TerminalOutcome::Completed));
        assert!(facts.observe_code(0));
        assert!(!facts.observe_code(0));
        assert_eq!(facts.outcome(), Some(TerminalOutcome::Completed));
        assert_eq!(facts.exit_code(), Some(0));
        facts.mark_conflict(true);
        facts.mark_conflict(false);
        facts.observe_outcome(TerminalOutcome::Completed);
        assert_eq!(facts.state(), TerminalState::Conflicting);
        assert_eq!(facts.outcome(), None);
        assert_eq!(facts.exit_code(), None);
    }

    #[test]
    fn order_does_not_resolve_terminal_disagreement() {
        for values in [
            [TerminalOutcome::Completed, TerminalOutcome::Failed],
            [TerminalOutcome::Failed, TerminalOutcome::Completed],
        ] {
            let mut facts = TerminalEvidence::default();
            for value in values {
                facts.observe_outcome(value);
            }
            assert_eq!(facts.state(), TerminalState::Conflicting);
        }
        for codes in [[0, 1], [1, 0]] {
            let mut facts = TerminalEvidence::default();
            facts.observe_outcome(TerminalOutcome::Completed);
            for code in codes {
                facts.observe_code(code);
            }
            assert_eq!(facts.state(), TerminalState::Conflicting);
        }
    }

    #[test]
    fn cancellation_decline_and_missing_terminal_are_not_success() {
        for outcome in [TerminalOutcome::Cancelled, TerminalOutcome::Declined] {
            let mut facts = TerminalEvidence::default();
            facts.observe_outcome(outcome);
            assert_eq!(facts.state(), TerminalState::Known(outcome));
        }
        let mut facts = TerminalEvidence::default();
        facts.observe_code(0);
        assert_eq!(facts.state(), TerminalState::Unobserved);
        assert_eq!(facts.outcome(), None);
        facts.mark_conflict(true);
        assert_eq!(facts.state(), TerminalState::Conflicting);
    }

    #[test]
    fn fold_agrees_with_independent_terminal_sets_for_every_three_record_history() {
        use std::collections::BTreeSet;
        let observations = [
            (None, None, false),
            (Some(TerminalOutcome::Completed), None, false),
            (Some(TerminalOutcome::Completed), Some(0), false),
            (Some(TerminalOutcome::Completed), Some(1), false),
            (Some(TerminalOutcome::Failed), Some(1), false),
            (Some(TerminalOutcome::Cancelled), None, false),
            (Some(TerminalOutcome::Declined), None, false),
            (None, None, true),
        ];
        for first in observations {
            for second in observations {
                for third in observations {
                    let history = [first, second, third];
                    let outcomes: BTreeSet<_> = history.iter().filter_map(|r| r.0).collect();
                    let codes: BTreeSet<_> = history.iter().filter_map(|r| r.1).collect();
                    let expected =
                        if history.iter().any(|r| r.2) || outcomes.len() > 1 || codes.len() > 1 {
                            TerminalState::Conflicting
                        } else {
                            outcomes
                                .first()
                                .copied()
                                .map_or(TerminalState::Unobserved, TerminalState::Known)
                        };
                    let mut facts = TerminalEvidence::default();
                    for (outcome, code, conflict) in history {
                        if let Some(outcome) = outcome {
                            facts.observe_outcome(outcome);
                        }
                        if let Some(code) = code {
                            facts.observe_code(code);
                        }
                        facts.mark_conflict(conflict);
                    }
                    assert_eq!(facts.state(), expected, "{history:?}");
                }
            }
        }
    }

    #[test]
    fn large_terminal_history_retains_only_two_code_witnesses() {
        let mut facts = TerminalEvidence::default();
        facts.observe_outcome(TerminalOutcome::Failed);
        let witnesses = (0..100_000)
            .filter(|&code| facts.observe_code(code))
            .count();
        assert_eq!(witnesses, 2);
        assert_eq!(facts.codes.first, Some(0));
        assert_eq!(facts.codes.second, Some(1));
        assert_eq!(facts.state(), TerminalState::Conflicting);
    }
}
