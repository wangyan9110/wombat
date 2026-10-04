//! Post-check associations are observations, never proof of adoption or savings.
use crate::{config::View, config_dto::Kind, optimize_dto::*};
use chrono::{DateTime, Utc};
use std::{collections::BTreeMap, path::PathBuf};

pub(super) fn observe(
    suggestions: &[Suggestion],
    view: &View,
    source: Option<&str>,
) -> Vec<FollowUpObservation> {
    let mut out = vec![];
    let mut files = BTreeMap::<(String, String), Vec<usize>>::new();
    let mut servers = BTreeMap::<(String, String), Vec<usize>>::new();
    let mut contexts = vec![];
    let now = DateTime::parse_from_rfc3339(&view.checked).ok();
    for suggestion in suggestions.iter().filter(|s| s.status == "verified") {
        let Some(record) = &suggestion.record_id else {
            continue;
        };
        let after = DateTime::parse_from_rfc3339(&suggestion.checked_at).ok();
        let item = view
            .items
            .iter()
            .find(|i| i.id == suggestion.item.id && i.current && !i.stale);
        let available = after.zip(now).is_some_and(|(a, n)| a <= n)
            && item.is_some_and(|i| i.kind != Kind::Hook)
            && view.snapshot.as_ref().is_some_and(|s| s.is_live())
            && matches!(
                view.history_status.as_str(),
                "current" | "fixed" | "partial"
            );
        let index = out.len();
        out.push(FollowUpObservation {
            record_id: record.clone(),
            suggestion_id: suggestion.id.clone(),
            status: if available {
                FollowUpStatus::NoObservedRecords
            } else {
                FollowUpStatus::Unavailable
            },
            after: suggestion.checked_at.clone(),
            observed_at: view.checked.clone(),
            observed_records: None,
            last_record_at: None,
            usage_revision: view
                .snapshot
                .as_ref()
                .map(|s| s.manifest.snapshot_ref.snapshot_id.clone()),
            absence_observable: false,
        });
        contexts.push((
            after,
            suggestion.scope_project.as_deref(),
            item.map(|i| (i.id.as_str(), i.project.as_deref())),
        ));
        if !available {
            continue;
        }
        let item = item.unwrap();
        // Unsupported runtime events cannot be inferred from names or file reads.
        let entries = match item.kind {
            Kind::Rule | Kind::Skill => &mut files,
            Kind::Mcp => &mut servers,
            Kind::Hook => continue,
        };
        for source_id in item
            .source_ids()
            .filter(|id| source.is_none_or(|s| s == *id))
        {
            let key = if item.kind == Kind::Mcp {
                item.native_key.as_deref().unwrap_or("")
            } else {
                &item.path
            };
            let indices = entries.entry((source_id.into(), key.into())).or_default();
            if !indices.contains(&index) {
                indices.push(index);
            }
        }
    }
    let Some(snapshot) = &view.snapshot else {
        return out;
    };
    if files.is_empty() && servers.is_empty() {
        return out;
    }
    // Ownership must include declarations outside this history page.
    let mut mcp_items = BTreeMap::<(String, String), Vec<&crate::config_dto::Item>>::new();
    for item in view
        .items
        .iter()
        .filter(|i| i.kind == Kind::Mcp && i.current && !i.stale)
    {
        for source in item.source_ids() {
            let key = (
                source.to_owned(),
                item.native_key.clone().unwrap_or_default(),
            );
            if servers.contains_key(&key) {
                mcp_items.entry(key).or_default().push(item);
            }
        }
    }
    let mut latest = vec![None; out.len()];
    let threads: BTreeMap<_, _> = snapshot
        .manifest
        .threads
        .iter()
        .map(|t| (t.thread.id.as_str(), &t.thread))
        .collect();
    // Each canonical operation is visited once; only the requested page has counters.
    for op in snapshot.operation_facts() {
        let Some(thread) = threads.get(op.thread_id.as_ref()) else {
            continue;
        };
        let Some(at) = op
            .timestamp
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        else {
            continue;
        };
        if now.is_none_or(|now| at > now) {
            continue;
        }
        let candidates = if op.name.as_ref() == "read_file"
            && matches!(op.kind.as_ref(), "tool" | "skillRead")
        {
            op.path.as_ref().and_then(|p| {
                let path = PathBuf::from(p);
                let path = if path.is_absolute() {
                    Some(path)
                } else {
                    thread
                        .project
                        .as_ref()
                        .map(|base| PathBuf::from(base).join(path))
                }?;
                let path = crate::absolute(path).ok()?;
                files.get(&(
                    thread.source_instance_id.clone(),
                    path.to_string_lossy().into_owned(),
                ))
            })
        } else if matches!(op.kind.as_ref(), "mcpTool" | "mcpResource") {
            op.server.as_ref().and_then(|server| {
                servers.get(&(thread.source_instance_id.clone(), server.to_string()))
            })
        } else {
            None
        };
        let candidates = candidates.into_iter().flatten().copied().filter(|&index| {
            contexts[index].0.is_some_and(|after| at > after)
                && contexts[index]
                    .1
                    .is_none_or(|p| thread.project.as_deref() == Some(p))
                && (!matches!(op.kind.as_ref(), "mcpTool" | "mcpResource")
                    || contexts[index].2.is_some_and(|(_, project)| {
                        project.is_none_or(|p| thread.project.as_deref() == Some(p))
                    }))
        });
        let mut owner = None;
        let mut ambiguous = false;
        for index in candidates.clone() {
            let id = contexts[index].2.unwrap().0;
            if owner.is_some_and(|old| old != id) {
                ambiguous = true;
                break;
            }
            owner = Some(id);
        }
        if matches!(op.kind.as_ref(), "mcpTool" | "mcpResource")
            && let Some(items) = op.server.as_ref().and_then(|server| {
                mcp_items.get(&(thread.source_instance_id.clone(), server.to_string()))
            })
        {
            for item in items.iter().filter(|i| {
                i.project
                    .as_deref()
                    .is_none_or(|p| thread.project.as_deref() == Some(p))
            }) {
                if owner.is_some_and(|old| old != item.id) {
                    ambiguous = true;
                    break;
                }
                owner = Some(item.id.as_str());
            }
        }
        if ambiguous {
            for index in candidates {
                if out[index].observed_records.is_none() {
                    out[index].status = FollowUpStatus::Unavailable;
                }
            }
            continue;
        }
        for index in candidates {
            let observation = &mut out[index];
            observation.status = FollowUpStatus::VersionUnknown;
            observation.observed_records = Some(observation.observed_records.unwrap_or(0) + 1);
            if latest[index].is_none_or(|last| at > last) {
                latest[index] = Some(at);
                observation.last_record_at = Some(at.with_timezone(&Utc).to_rfc3339());
            }
        }
    }
    out
}
