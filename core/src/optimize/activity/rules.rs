//! Fixed-turn rule declarations. Algorithms consume the shared timing result.
use crate::{optimize_dto::ActivityRule, timing_dto::Basis};

pub(super) const RULES: [ActivityRule; 5] = [
    ActivityRule::InspectCallsAfterFailure,
    ActivityRule::InspectRepeatedReads,
    ActivityRule::InspectRepeatedRequests,
    ActivityRule::InspectFailureShare,
    ActivityRule::InspectInputChange,
];

pub(super) struct Definition {
    pub version: u32,
    pub method: &'static str,
    pub basis: Basis,
}

impl ActivityRule {
    pub(super) fn definition(self) -> Definition {
        let (method, basis) = match self {
            Self::InspectCallsAfterFailure => {
                ("same_operation_after_failure_v1", Basis::RepeatAfterFailure)
            }
            Self::InspectRepeatedReads => ("same_target_read_v1", Basis::SuccessfulReadRepeat),
            Self::InspectRepeatedRequests => {
                ("same_request_observation_v1", Basis::SameRequestObservation)
            }
            Self::InspectFailureShare => (
                "terminal_failure_inspection_v1",
                Basis::DeterminateTerminalOutcomes,
            ),
            Self::InspectInputChange => ("request_input_change_inspection_v1", Basis::RequestInput),
        };
        Definition {
            version: 1,
            method,
            basis,
        }
    }
}
