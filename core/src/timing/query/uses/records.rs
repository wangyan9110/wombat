//! A bounded local page over authoritative canonical rows; no call/result pairing.
use super::*;
fn row_ref(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    index: usize,
    record: &projection::Record<'_>,
) -> String {
    cursor::reference(
        snapshot,
        target,
        &["record", &index.to_string(), &record.operation.id],
    )
}
pub(super) fn row(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    uses: &projection::TurnUses<'_>,
    index: usize,
) -> UseRecord {
    let record = &uses.records[index];
    let op = record.operation;
    let parsed = op
        .timestamp
        .as_deref()
        .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
        .map(|time| time.timestamp_millis());
    let (timestamp_ms, numeric_range) = super::super::safe_timestamp(parsed);
    let mut gaps = vec![];
    if !record.identity_known {
        gaps.push("missing_identity".into());
    }
    if record.object.is_none() {
        gaps.push("missing_target".into());
    }
    if record.target_conflict {
        gaps.push("target_conflict".into());
    }
    if record.state != projection::UseState::Used {
        gaps.push("dispatch_not_proven".into());
    }
    if record.time_basis == observations::TimeBasis::Unknown {
        gaps.push("missing_time".into());
    }
    if numeric_range
        || op.duration_ms.is_some_and(|n| n > MAX_SAFE_INTEGER)
        || op
            .exit_code
            .is_some_and(|n| n.unsigned_abs() > MAX_SAFE_INTEGER)
    {
        gaps.push("numeric_range".into());
    }
    UseRecord {
        reference: row_ref(snapshot, target, index, record),
        object_ref: record
            .object
            .map(|index| object_ref(snapshot, target, &uses.objects[index].key)),
        kind: record.kind.map(|kind| match kind {
            observations::UseKind::SkillRead => UseKind::SkillRead,
            observations::UseKind::McpTool => UseKind::McpTool,
            observations::UseKind::McpResource => UseKind::McpResource,
        }),
        state: state(record.state),
        outcome: match op.status.as_ref() {
            "running" | "started" | "pending" => UseOutcome::Running,
            "completed" => UseOutcome::Completed,
            "failed" => UseOutcome::Failed,
            "cancelled" => UseOutcome::Cancelled,
            "interrupted" => UseOutcome::Interrupted,
            _ => UseOutcome::Unknown,
        },
        timestamp_ms,
        time_basis: match record.time_basis {
            observations::TimeBasis::SourceOperationTime => UseTimeBasis::SourceOperationTime,
            observations::TimeBasis::Unknown => UseTimeBasis::Unknown,
        },
        native_duration_ms: op.duration_ms.filter(|n| *n <= MAX_SAFE_INTEGER),
        tool: op.tool.as_deref().map(str::to_owned),
        exit_code: op
            .exit_code
            .filter(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER),
        identity_known: record.identity_known,
        replay_of: record
            .replay_of
            .map(|prior| row_ref(snapshot, target, prior, &uses.records[prior])),
        target_conflict: record.target_conflict,
        gap_codes: gaps,
    }
}
