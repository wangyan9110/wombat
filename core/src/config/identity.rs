//! One local physical object; source inventory identities remain separate evidence.
use crate::config_dto::{Counts, Issue, Item, Observation, SourceContext};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn aggregate(items: &mut Vec<Item>, issues: &mut Vec<Issue>) {
    let mut groups: BTreeMap<String, Vec<Item>> = BTreeMap::new();
    for item in items.drain(..) {
        let key = crate::hash(
            serde_json::to_vec(&(&item.path, &item.kind, &item.native_key))
                .expect("serializable identity"),
        );
        groups.entry(key).or_default().push(item);
    }
    for (key, mut group) in groups {
        group.sort_by(|a, b| a.source_instance_id.cmp(&b.source_instance_id));
        let first = &group[0];
        if group.iter().skip(1).any(|item| {
            item.content_hash != first.content_hash
                || item.measurement_status != first.measurement_status
                || item.configured_state != first.configured_state
        }) {
            // A file may change between source reads; never silently choose one version.
            if issues.len() < 256 {
                issues.push(Issue {
                    code: "configContentChangedDuringScan".into(),
                    path: Some(group[0].path.clone()),
                });
            }
            items.extend(group);
            continue;
        }
        let mut contexts: Vec<_> = group
            .iter()
            .flat_map(|i| {
                if i.source_contexts.is_empty() {
                    vec![SourceContext {
                        inventory_id: i.id.clone(),
                        source_instance_id: i.source_instance_id.clone(),
                        content_hash: i.content_hash.clone(),
                        configured_state: i.configured_state.clone(),
                        global: i.project.is_none(),
                        counts: Counts::default(),
                        observation: Observation::Unknown,
                        last_record_at: None,
                    }]
                } else {
                    i.source_contexts.clone()
                }
            })
            .collect();
        contexts.sort_by(|a, b| (&a.inventory_id, !a.global).cmp(&(&b.inventory_id, !b.global)));
        contexts.dedup_by(|a, b| a.inventory_id == b.inventory_id);
        let memberships: BTreeSet<_> = group
            .iter()
            .flat_map(|i| i.authorized_projects.iter().cloned())
            .collect();
        let global = contexts.iter().any(|c| c.global);
        let mut item = group.remove(0);
        item.id = format!("local-object:{key}");
        item.source_instance_id = contexts
            .iter()
            .map(|c| &c.source_instance_id)
            .min()
            .unwrap()
            .clone();
        item.source_contexts = contexts;
        item.authorized_projects = memberships.into_iter().collect();
        if global {
            item.project = None;
        }
        items.push(item);
    }
    items.sort_by(|a, b| a.id.cmp(&b.id));
}
