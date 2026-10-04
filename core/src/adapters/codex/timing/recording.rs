//! One source row allocates a single ordered namespace for all safe observations.
use super::*;

pub(in crate::adapters::codex) struct Context {
    position: Position,
    time: Time,
    gaps: Vec<Gap>,
    phase: Phase,
}
impl Context {
    pub(in crate::adapters::codex) fn new(
        position: Position,
        timestamp: Option<&str>,
        kind: &str,
        subtype: Option<&str>,
    ) -> Self {
        let (time, gap) = Time::from_source(timestamp);
        let event = if kind == "event_msg" || kind == "response_item" {
            subtype.unwrap_or("")
        } else {
            kind
        };
        let phase = match event {
            "item_started" | "mcp_tool_call_begin" | "function_call" | "custom_tool_call" => {
                Phase::Started
            }
            "item_completed"
            | "mcp_tool_call_end"
            | "function_call_output"
            | "custom_tool_call_output" => Phase::Completed,
            _ => Phase::Unknown,
        };
        Self {
            position,
            time,
            gaps: gap.into_iter().collect(),
            phase,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn record(
    facts: &mut Facts,
    thread: Option<String>,
    turn: Option<String>,
    payload: SafePayload,
    mut gaps: Vec<Gap>,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) {
    let Some(context) = &mut facts.event_context else {
        issue(
            report,
            "missingEventContext",
            "事件缺少来源位置，无法建立投影",
            Some(evidence.clone()),
        );
        return;
    };
    for gap in &context.gaps {
        if !gaps.contains(gap) {
            gaps.push(gap.clone());
        }
    }
    let position = context.position.clone();
    context.position.ordinal += 1;
    match Event::new(position, thread, turn, context.time.clone(), gaps, payload) {
        Ok(event) => {
            crate::adapters::codex::event_projection::apply(facts, &event, report);
            let id = event.id().to_owned();
            facts.dirty_events.insert(id.clone());
            facts.events.insert(id, Arc::new(event));
        }
        Err(_) => issue(
            report,
            "invalidEventIdentity",
            "事件关联身份不完整",
            Some(evidence.clone()),
        ),
    }
}

pub(in crate::adapters::codex) fn operation(
    facts: &mut Facts,
    operation: &Operation,
    report: &mut SourceReport,
) {
    let Some(context) = &facts.event_context else {
        issue(
            report,
            "missingEventContext",
            "事件缺少来源位置，无法建立投影",
            operation.evidence.first().cloned(),
        );
        return;
    };
    let phase = match operation.status.as_ref() {
        "failed" => Phase::Failed,
        "interrupted" => Phase::Cancelled,
        "completed" if context.phase != Phase::Unknown => Phase::Completed,
        _ => context.phase.clone(),
    };
    let Some(evidence) = operation.evidence.first() else {
        return;
    };
    record(
        facts,
        Some(operation.thread_id.to_string()),
        operation.turn_id.as_deref().map(str::to_owned),
        SafePayload::Operation {
            value: Arc::new(operation.clone()),
            phase,
        },
        vec![],
        report,
        evidence,
    );
}

pub(in crate::adapters::codex) fn measurement(
    facts: &mut Facts,
    candidate: &Candidate,
    report: &mut SourceReport,
) {
    let value = &candidate.measurement;
    let Some(evidence) = value.evidence.first() else {
        return;
    };
    record(
        facts,
        value.thread_id.as_deref().map(str::to_owned),
        value.turn_id.as_deref().map(str::to_owned),
        SafePayload::Measurement {
            value: value.clone(),
            direct: candidate.direct,
            cumulative: candidate.cumulative,
            interval_start: candidate.interval_start,
            fingerprint: candidate.fingerprint.clone(),
        },
        vec![],
        report,
        evidence,
    );
}

pub(in crate::adapters::codex) fn ancestry(
    facts: &mut Facts,
    thread: &str,
    parent_id: String,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) {
    record(
        facts,
        Some(thread.into()),
        None,
        SafePayload::Ancestry {
            parent_id,
            evidence: evidence.clone(),
        },
        vec![],
        report,
        evidence,
    );
}
