//! Reliable source outcome metadata. Never interpret a result body as a process transcript.
use super::*;

fn negative(status: &str) -> u8 {
    match status {
        "failed" => 3,
        "interrupted" => 2,
        "declined" => 1,
        _ => 0,
    }
}
fn terminal(status: &str) -> bool {
    status == "completed" || negative(status) != 0
}
pub(super) fn result_status(op: &mut Operation, status: &str) {
    if negative(status) > negative(&op.status) || negative(&op.status) == 0 && status == "completed"
    {
        op.status = status.into();
    }
}
fn conflict(op: &mut Operation, report: &mut SourceReport) {
    op.outcome_conflict = true;
    op.exit_code = None;
    issue(
        report,
        "operationResultConflict",
        "同一操作的可靠结果证据冲突",
        op.evidence.first().cloned(),
    );
}

pub(super) fn apply(
    op: &mut Operation,
    item: &Payload<'_>,
    completed: bool,
    native_mcp: bool,
    report: &mut SourceReport,
) {
    #[derive(Deserialize)]
    struct ResultMetadata {
        #[serde(alias = "isError")]
        is_error: Option<bool>,
        #[serde(alias = "exitCode")]
        exit_code: Option<i64>,
        #[serde(alias = "durationMs")]
        duration_ms: Option<u64>,
    }
    let mut exit = item.exit_code;
    let mut error = None;
    let mut contradictory = false;
    let mut failed = exit.is_some_and(|value| value != 0);
    for raw in [item.result, item.output].into_iter().flatten() {
        let Some(metadata) = raw
            .get()
            .starts_with('{')
            .then(|| serde_json::from_str::<ResultMetadata>(raw.get()).ok())
            .flatten()
        else {
            continue;
        };
        if let Some(value) = metadata.exit_code {
            failed |= value != 0;
            contradictory |= exit.is_some_and(|previous| previous != value);
            exit = Some(value);
        }
        if let Some(value) = metadata.is_error {
            failed |= value;
            contradictory |= error.is_some_and(|previous| previous != value);
            error = Some(value);
        }
        op.duration_ms = metadata
            .duration_ms
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .or(op.duration_ms);
    }
    if failed {
        result_status(op, "failed");
    }
    op.exit_code = exit;
    if contradictory {
        conflict(op, report);
    } else if completed
        && !native_mcp
        && negative(&op.status) == 0
        && (exit == Some(0) || error == Some(false))
    {
        op.status = "completed".into();
    }
}

pub(super) fn merge(old: &mut Operation, incoming: &Operation, report: &mut SourceReport) {
    let old_terminal = terminal(&old.status);
    let new_terminal = terminal(&incoming.status);
    let different_status = old_terminal && new_terminal && old.status != incoming.status;
    let different_exit = old_terminal
        && new_terminal
        && old
            .exit_code
            .zip(incoming.exit_code)
            .is_some_and(|(left, right)| left != right);
    let is_conflict =
        old.outcome_conflict || incoming.outcome_conflict || different_status || different_exit;
    let code = if is_conflict {
        None
    } else if old_terminal && !new_terminal {
        old.exit_code
    } else if new_terminal && !old_terminal || incoming.status.as_ref() == "unknown" {
        incoming.exit_code
    } else if old.status.as_ref() == "unknown" && incoming.status.as_ref() == "running" {
        old.exit_code
    } else {
        incoming.exit_code.or(old.exit_code)
    };
    if negative(&incoming.status) > negative(&old.status)
        || negative(&old.status) == 0
            && (incoming.status.as_ref() == "completed"
                || incoming.status.as_ref() == "unknown" && old.status.as_ref() == "running")
    {
        old.status.clone_from(&incoming.status);
    }
    if is_conflict && !old.outcome_conflict && !incoming.outcome_conflict {
        conflict(old, report);
    }
    old.outcome_conflict = is_conflict;
    old.exit_code = code;
}
