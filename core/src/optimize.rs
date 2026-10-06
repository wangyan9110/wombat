//! Static optimization rules and durable review decisions share one inventory basis.
pub(crate) mod activity;
mod cache;
mod detection;
mod evaluation;
mod follow_up;
#[cfg(test)]
#[path = "optimize/follow_up_tests.rs"]
mod follow_up_tests;
mod identity;
mod inputs;
mod registry;
mod repository;
mod reviews;
mod service;
mod store;
#[cfg(test)]
mod tests;

pub(crate) use detection::parameters;
pub(crate) use service::execute;
pub(crate) use service::pending_for_handoff;

use crate::optimize_dto::*;
pub(crate) fn capabilities() -> Response {
    Response {
        output_version: 2,
        action: Action::Capabilities,
        capabilities: Capabilities::default(),
        read_view: None,
        config_revision: String::new(),
        usage_revision: None,
        decision_revision: String::new(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        suggestions: vec![],
        pending: 0,
        history: 0,
        page: crate::usage_app_dto::Page {
            offset: 0,
            limit: 50,
            total: 0,
            next_offset: None,
        },
        issues: vec![],
        result_status: "complete".into(),
        rule_parameters: RuleParameters::default(),
        rule_catalog: registry::catalog(),
        checks: vec![],
        follow_ups: vec![],
        activity: None,
    }
}
