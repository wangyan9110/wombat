//! Preserve field-level measurement contradictions without invalidating other observations.
use super::*;
use crate::session_events::MeasurementContextField;

pub(super) fn clear_fields(value: &mut Measurement, fields: &[MeasurementContextField]) {
    for field in fields {
        if *field != MeasurementContextField::Effort {
            value.pricing_context_conflict = true;
        }
        match field {
            MeasurementContextField::Model => value.model.raw = None,
            MeasurementContextField::Provider => value.model.provider = None,
            MeasurementContextField::ApiProvider => value.model.api_provider = None,
            MeasurementContextField::Effort => value.reasoning_effort = None,
        }
    }
}

/// Reconstruct the same namespace used by cross-record accounting reconciliation.
pub(super) fn apply(
    facts: &mut Facts,
    candidate: &mut Candidate,
    fields: &[MeasurementContextField],
    report: &mut SourceReport,
) {
    let prefix = &candidate.measurement.id;
    let namespace = [
        (MeasurementContextField::Model, "model"),
        (MeasurementContextField::Provider, "provider"),
        (MeasurementContextField::ApiProvider, "apiProvider"),
        (MeasurementContextField::Effort, "effort"),
    ];
    let mut affected = Vec::new();
    for (field, suffix) in namespace {
        let key = format!("{prefix}:{suffix}");
        if fields.contains(&field) {
            facts.measurement_conflicts.insert(key.clone());
        }
        if facts.measurement_conflicts.contains(&key) {
            affected.push(field);
        }
    }
    if !fields.is_empty() {
        issue(
            report,
            "contextConflict",
            "用量记录的显式模型或推理强度字段冲突",
            candidate.measurement.evidence.first().cloned(),
        );
    }
    if !affected.is_empty() {
        clear_fields(Arc::make_mut(&mut candidate.measurement), &affected);
    }
}

/// Missing settings preserve a previous contradiction; an explicit new setting replaces it.
pub(super) fn inherit_conflicts(
    model: &ModelRef,
    effort: Option<&str>,
    previous: &[MeasurementContextField],
    conflicts: &mut Vec<MeasurementContextField>,
) {
    for (field, missing) in [
        (MeasurementContextField::Model, model.raw.is_none()),
        (MeasurementContextField::Provider, model.provider.is_none()),
        (
            MeasurementContextField::ApiProvider,
            model.api_provider.is_none(),
        ),
        (MeasurementContextField::Effort, effort.is_none()),
    ] {
        if missing && previous.contains(&field) && !conflicts.contains(&field) {
            conflicts.push(field);
        }
    }
}
