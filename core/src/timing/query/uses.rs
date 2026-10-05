//! Shared canonical-use projection and local-only object/record paging.
use super::*;
use crate::{timing::uses as projection, usage_observations as observations};
use usage_store::timing_evidence::TimingEvidence;
const SUMMARY_LIMIT: usize = 50;
const DETAIL_BYTES: usize = 128 * 1024;
mod cursor;
mod records;
fn limit() -> anyhow::Error {
    operation_error("RESOURCE_LIMIT", "Use detail exceeds resource budget")
}
fn count(value: Option<u64>, basis: Basis) -> Count {
    m::count(
        value.map(u128::from),
        basis,
        &["collection:canonical_operations".into()],
    )
}
fn records_count(value: usize) -> Count {
    count(Some(value as u64), Basis::CanonicalUseRecords)
}
fn membership(value: Option<usize>) -> Count {
    count(
        value.map(|n| n as u64),
        if value.is_some() {
            Basis::UnassignedUseIndex
        } else {
            Basis::MissingTurn
        },
    )
}
fn coverage(coverage: &observations::Coverage) -> UseCoverage {
    UseCoverage {
        dispatch_gaps: records_count(coverage.dispatch_gaps),
        identity_gaps: records_count(coverage.identity_gaps),
        target_gaps: records_count(coverage.target_gaps),
        time_gaps: records_count(coverage.time_gaps),
        associated_turn_gaps: records_count(coverage.turn_gaps),
    }
}
fn project<'a>(
    evidence: &'a TimingEvidence<'_>,
    turn: &'a str,
    cancelled: &'a AtomicBool,
) -> Result<projection::TurnUses<'a>> {
    projection::project(projection::Input {
        thread: evidence.thread,
        turn,
        source: evidence.source,
        operations: &evidence.operations,
        membership: projection::MembershipCoverage {
            skill: Some(evidence.unassigned_uses.skill_records),
            mcp: Some(evidence.unassigned_uses.mcp_records),
        },
        budget: projection::Budget::default(),
        cancelled,
    })
}
fn totals(uses: &projection::TurnUses<'_>) -> UseTotals {
    UseTotals {
        method_version: uses.method_version,
        source_coverage: match uses.source_coverage {
            projection::SourceCoverage::Complete => UseSourceCoverage::Complete,
            projection::SourceCoverage::Partial => UseSourceCoverage::Partial,
            projection::SourceCoverage::Unknown => UseSourceCoverage::Unknown,
        },
        object_count: records_count(uses.objects.len()),
        record_count: records_count(uses.records.len()),
        unbound_target_records: records_count(uses.unassigned_records.len()),
        unassigned_skill_records: membership(uses.membership.skill),
        unassigned_mcp_records: membership(uses.membership.mcp),
        coverage: coverage(&uses.coverage),
    }
}
pub(super) fn unavailable(basis: Basis) -> LocalUses {
    LocalUses {
        totals: UseTotals {
            method_version: observations::METHOD_VERSION,
            source_coverage: UseSourceCoverage::Unknown,
            object_count: m::unavailable(basis),
            record_count: m::unavailable(basis),
            unbound_target_records: m::unavailable(basis),
            unassigned_skill_records: m::unavailable(basis),
            unassigned_mcp_records: m::unavailable(basis),
            coverage: UseCoverage {
                dispatch_gaps: m::unavailable(basis),
                identity_gaps: m::unavailable(basis),
                target_gaps: m::unavailable(basis),
                time_gaps: m::unavailable(basis),
                associated_turn_gaps: m::unavailable(basis),
            },
        },
        detail: m::capability(Support::Unavailable, basis),
        limit: SUMMARY_LIMIT,
        objects: vec![],
        next_cursor: None,
    }
}
pub(super) fn omit_detail(uses: &mut LocalUses, basis: Basis) {
    uses.objects.clear();
    uses.next_cursor = None;
    uses.detail = m::capability(Support::Unavailable, basis);
}
fn object_ref(snapshot: &Snapshot, target: TurnTarget<'_>, key: &projection::ObjectKey) -> String {
    match key {
        projection::ObjectKey::Skill { source, path } => {
            cursor::reference(snapshot, target, &["skill", source, path])
        }
        projection::ObjectKey::Mcp {
            source,
            project,
            server,
        } => cursor::reference(
            snapshot,
            target,
            &[
                "mcp",
                source,
                if project.is_some() {
                    "project"
                } else {
                    "no_project"
                },
                project.as_deref().unwrap_or(""),
                server,
            ],
        ),
    }
}
fn state(value: projection::UseState) -> UseState {
    match value {
        projection::UseState::Used => UseState::Used,
        projection::UseState::Candidate => UseState::Candidate,
        projection::UseState::Unclassified => UseState::Unclassified,
    }
}
fn missing(coverage: &observations::Coverage) -> Basis {
    if coverage.dispatch_gaps > 0 {
        Basis::DispatchNotProven
    } else if coverage.identity_gaps > 0 {
        Basis::MissingIdentity
    } else if coverage.target_gaps > 0 {
        Basis::MissingTarget
    } else {
        Basis::MissingTurn
    }
}
fn object(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    uses: &projection::TurnUses<'_>,
    index: usize,
) -> UseObject {
    let object = &uses.objects[index];
    let (kind, path, server, project) = match object.key.as_ref() {
        projection::ObjectKey::Skill { path, .. } => {
            (UseObjectKind::Skill, Some(path.clone()), None, None)
        }
        projection::ObjectKey::Mcp {
            server, project, ..
        } => (
            UseObjectKind::Mcp,
            None,
            Some(server.clone()),
            project.clone(),
        ),
    };
    let object_state = if object
        .records
        .iter()
        .any(|index| uses.records[*index].state == projection::UseState::Used)
    {
        UseState::Used
    } else if object
        .records
        .iter()
        .any(|index| uses.records[*index].state == projection::UseState::Candidate)
    {
        UseState::Candidate
    } else {
        UseState::Unclassified
    };
    let associated = count(
        object.associated_use_count,
        if object.associated_use_count.is_some() {
            Basis::CanonicalUseIdentity
        } else {
            missing(&object.coverage)
        },
    );
    UseObject {
        object_ref: object_ref(snapshot, target, &object.key),
        kind,
        state: object_state,
        path,
        server,
        project,
        associated_use_count: associated.clone(),
        use_count: if object.use_count.is_some() || object.associated_use_count.is_none() {
            associated
        } else {
            m::unavailable(Basis::MissingTurn)
        },
        record_count: records_count(object.records.len()),
        unassigned_turn_records: membership(object.unassigned_turn_records),
        coverage: coverage(&object.coverage),
    }
}
fn order(uses: &projection::TurnUses<'_>, cancelled: &AtomicBool) -> Result<Vec<usize>> {
    check(cancelled)?;
    let mut indices = (0..uses.objects.len()).collect::<Vec<_>>();
    indices.sort_unstable_by(|a, b| {
        let a = &uses.objects[*a];
        let b = &uses.objects[*b];
        b.associated_use_count
            .cmp(&a.associated_use_count)
            .then_with(|| a.key.cmp(&b.key))
    });
    check(cancelled)?;
    Ok(indices)
}
fn object_rows(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    uses: &projection::TurnUses<'_>,
    indices: &[usize],
    cancelled: &AtomicBool,
) -> Result<Vec<UseObject>> {
    let mut bytes = 0usize;
    for index in indices {
        check(cancelled)?;
        let strings = match uses.objects[*index].key.as_ref() {
            projection::ObjectKey::Skill { path, .. } => path.len(),
            projection::ObjectKey::Mcp {
                project, server, ..
            } => project
                .as_ref()
                .map_or(0, String::len)
                .saturating_add(server.len()),
        };
        bytes = bytes
            .checked_add(strings)
            .filter(|n| *n <= DETAIL_BYTES)
            .ok_or_else(limit)?;
    }
    indices
        .iter()
        .map(|index| {
            check(cancelled)?;
            Ok(object(snapshot, target, uses, *index))
        })
        .collect()
}
pub(super) fn summary(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    evidence: Option<&TimingEvidence<'_>>,
    profile: PrivacyProfile,
    cancelled: &AtomicBool,
) -> Result<LocalUses> {
    let Some(evidence) = evidence else {
        return Ok(unavailable(Basis::ResourceLimit));
    };
    let uses = match project(evidence, target.turn, cancelled) {
        Ok(uses) => uses,
        Err(error)
            if error
                .downcast_ref::<crate::dto::OperationError>()
                .is_some_and(|e| e.code == "RESOURCE_LIMIT") =>
        {
            return Ok(unavailable(Basis::ResourceLimit));
        }
        Err(error) => return Err(error),
    };
    let mut out = LocalUses {
        totals: totals(&uses),
        detail: m::capability(Support::Supported, Basis::CanonicalUseIdentity),
        limit: SUMMARY_LIMIT,
        objects: vec![],
        next_cursor: None,
    };
    if profile == PrivacyProfile::ShareV1 {
        omit_detail(&mut out, Basis::UnsupportedMethod);
        return Ok(out);
    }
    let detail = (|| -> Result<()> {
        let indices = order(&uses, cancelled)?;
        out.objects = object_rows(
            snapshot,
            target,
            &uses,
            &indices[..indices.len().min(SUMMARY_LIMIT)],
            cancelled,
        )?;
        if indices.len() > SUMMARY_LIMIT {
            out.next_cursor = Some(cursor::encode(
                snapshot,
                target,
                EvidenceSet::UseObjects,
                None,
                SUMMARY_LIMIT,
            )?);
        }
        if !super::fits_limit(&out, DETAIL_BYTES)? {
            return Err(limit());
        }
        Ok(())
    })();
    if let Err(error) = detail {
        if error
            .downcast_ref::<crate::dto::OperationError>()
            .is_some_and(|e| e.code == "RESOURCE_LIMIT")
        {
            omit_detail(&mut out, Basis::ResourceLimit);
        } else {
            return Err(error);
        }
    }
    Ok(out)
}
pub(super) fn page(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    scope: LocalScope,
    request: &Request,
    cancelled: &AtomicBool,
) -> Result<Response> {
    let Request::Evidence {
        collection,
        object_ref: selected,
        cursor: input_cursor,
        limit: page_limit,
        ..
    } = request
    else {
        unreachable!()
    };
    let offset = cursor::offset(
        snapshot,
        target,
        *collection,
        selected.as_deref(),
        input_cursor.as_ref(),
    )?;
    let evidence = snapshot.timing_evidence(target, TimingReadBudget::default(), cancelled)?;
    let uses = project(&evidence, target.turn, cancelled)?;
    let totals = totals(&uses);
    let response = match collection {
        EvidenceSet::UseObjects => {
            let indices = order(&uses, cancelled)?;
            if offset > indices.len() {
                return super::invalid();
            }
            let end = offset.saturating_add(*page_limit).min(indices.len());
            Response::UseObjects(UseObjectsResponse {
                output_version: OUTPUT_VERSION,
                action: EvidenceAction::Evidence,
                collection: UseObjectPageKind::UseObjects,
                method_version: METHOD_VERSION.into(),
                profile: LocalProfile::Local,
                snapshot_id: evidence.snapshot_id.into(),
                scope,
                totals,
                total: records_count(indices.len()),
                rows: object_rows(snapshot, target, &uses, &indices[offset..end], cancelled)?,
                next_cursor: (end < indices.len())
                    .then(|| cursor::encode(snapshot, target, *collection, None, end))
                    .transpose()?,
            })
        }
        EvidenceSet::UseRecords => {
            let object = if let Some(selected) = selected {
                let mut found = None;
                for (index, object) in uses.objects.iter().enumerate() {
                    check(cancelled)?;
                    if object_ref(snapshot, target, &object.key) == *selected {
                        found = Some(index);
                        break;
                    }
                }
                Some(found.ok_or_else(|| {
                    operation_error("INVALID_ARGUMENT", "Use object is not in this read scope")
                })?)
            } else {
                None
            };
            let total = object.map_or(uses.records.len(), |object| {
                uses.objects[object].records.len()
            });
            if offset > total {
                return super::invalid();
            }
            let end = offset.saturating_add(*page_limit).min(total);
            let mut bytes = 0usize;
            let rows = (offset..end)
                .map(|position| {
                    check(cancelled)?;
                    let index =
                        object.map_or(position, |object| uses.objects[object].records[position]);
                    bytes = bytes
                        .checked_add(
                            uses.records[index]
                                .operation
                                .tool
                                .as_ref()
                                .map_or(0, |tool| tool.len()),
                        )
                        .filter(|n| *n <= DETAIL_BYTES)
                        .ok_or_else(limit)?;
                    Ok(records::row(snapshot, target, &uses, index, object))
                })
                .collect::<Result<Vec<_>>>()?;
            Response::UseRecords(UseRecordsResponse {
                output_version: OUTPUT_VERSION,
                action: EvidenceAction::Evidence,
                collection: UseRecordPageKind::UseRecords,
                method_version: METHOD_VERSION.into(),
                profile: LocalProfile::Local,
                snapshot_id: evidence.snapshot_id.into(),
                scope,
                object_ref: selected.clone(),
                totals,
                total: records_count(total),
                rows,
                next_cursor: (end < total)
                    .then(|| {
                        cursor::encode(snapshot, target, *collection, selected.as_deref(), end)
                    })
                    .transpose()?,
            })
        }
        EvidenceSet::TurnEvents => unreachable!(),
    };
    if !super::fits(&response)? {
        return Err(limit());
    }
    check(cancelled)?;
    Ok(response)
}
#[cfg(test)]
mod tests;
