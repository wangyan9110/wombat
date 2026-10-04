//! Borrow exact JSON declarations, including native-listed inline plugin documents.
use super::*;
use serde_json::value::RawValue;
use std::collections::BTreeMap;
type Object<'a> = BTreeMap<String, &'a RawValue>;

impl Inventory {
    pub(super) fn hooks(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        now: &str,
    ) {
        self.json_hooks(path, allowed, source, project, now, None);
    }
    pub(super) fn plugin_hooks(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        now: &str,
        selected: &BTreeSet<String>,
    ) {
        self.json_hooks(path, allowed, source, project, now, Some(selected));
    }
    #[allow(clippy::too_many_arguments)]
    fn json_hooks(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        now: &str,
        selected: Option<&BTreeSet<String>>,
    ) {
        let Some(text) = self.read(path, allowed) else {
            return;
        };
        let hash = crate::hash(&text);
        let documents = documents(&text, selected);
        let Some(documents) = documents else {
            self.issue("hookConfigInvalid", path);
            return;
        };
        for (prefix, event_document, document_index) in documents {
            let Ok(events) = serde_json::from_str::<Object<'_>>(event_document.get()) else {
                self.issue("hookConfigInvalid", path);
                continue;
            };
            for (event, raw_groups) in events {
                let Ok(groups) = serde_json::from_str::<Vec<&RawValue>>(raw_groups.get()) else {
                    self.issue("hookConfigInvalid", path);
                    continue;
                };
                for (group_index, group) in groups.iter().enumerate() {
                    let handlers = serde_json::from_str::<Object<'_>>(group.get())
                        .ok()
                        .and_then(|group| {
                            group.get("hooks").and_then(|raw| {
                                serde_json::from_str::<Vec<&RawValue>>(raw.get()).ok()
                            })
                        });
                    let Some(handlers) = handlers else {
                        self.issue("hookConfigInvalid", path);
                        continue;
                    };
                    for (handler_index, handler) in handlers.iter().enumerate() {
                        let key = format!(
                            "{prefix}/{}/{group_index}/hooks/{handler_index}",
                            event.replace('~', "~0").replace('/', "~1")
                        );
                        if selected.is_some_and(|keys| !keys.contains(&key)) {
                            continue;
                        }
                        if self.items.len() >= ENTRY_LIMIT {
                            self.issue("resourceLimited", path);
                            return;
                        }
                        if !handler.get().starts_with('{') {
                            self.issue("hookConfigInvalid", path);
                            continue;
                        }
                        let name = match document_index {
                            Some(n) => format!(
                                "{event} · {}/{}.{}",
                                n + 1,
                                group_index + 1,
                                handler_index + 1
                            ),
                            None => format!("{event} · {}.{}", group_index + 1, handler_index + 1),
                        };
                        let mut row = item(
                            path,
                            source,
                            project,
                            Kind::Hook,
                            name,
                            Some(key),
                            "declared",
                            &text,
                            now,
                            Some(&hash),
                        );
                        self.hook_measurement(&mut row, Some(handler.get()), path);
                        self.items.push(row);
                    }
                }
            }
        }
        self.issue("hookEffectiveRegistryUnavailable", path);
    }
}

fn documents<'a>(
    text: &'a str,
    selected: Option<&BTreeSet<String>>,
) -> Option<Vec<(String, &'a RawValue, Option<usize>)>> {
    let doc = serde_json::from_str::<Object<'a>>(text).ok()?;
    let hooks = *doc.get("hooks")?;
    let inline = selected.is_some_and(|keys| {
        keys.iter().any(|key| {
            key.starts_with("/hooks/hooks/")
                || key
                    .strip_prefix("/hooks/")
                    .and_then(|s| s.split_once('/'))
                    .is_some_and(|(part, _)| part.parse::<usize>().is_ok())
        })
    });
    if !inline {
        return Some(vec![("/hooks".into(), hooks, None)]);
    }
    if hooks.get().starts_with('{') {
        let obj = serde_json::from_str::<Object<'a>>(hooks.get()).ok()?;
        Some(vec![("/hooks/hooks".into(), *obj.get("hooks")?, None)])
    } else {
        let docs = serde_json::from_str::<Vec<&'a RawValue>>(hooks.get()).ok()?;
        let indexes: BTreeSet<usize> = selected?
            .iter()
            .filter_map(|key| key.strip_prefix("/hooks/")?.split_once('/')?.0.parse().ok())
            .collect();
        Some(
            indexes
                .into_iter()
                .filter_map(|index| {
                    let raw = docs.get(index)?;
                    let prefix = format!("/hooks/{index}/hooks");
                    let doc = serde_json::from_str::<Object<'a>>(raw.get()).ok()?;
                    Some((prefix, *doc.get("hooks")?, Some(index)))
                })
                .collect(),
        )
    }
}
