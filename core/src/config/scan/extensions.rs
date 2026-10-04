//! MCP and Hook declarations; configuration does not imply effectiveness.
use super::*;
impl Inventory {
    pub(super) fn mcp(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        now: &str,
    ) {
        let Some(text) = self.read(path, allowed) else {
            return;
        };
        let file_hash = crate::hash(&text);
        let doc = match toml_edit::Document::parse(text.as_str()) {
            Ok(v) => v,
            Err(_) => {
                self.issue("configInvalid", path);
                return;
            }
        };
        if let Some(table) = doc
            .get("mcp_servers")
            .and_then(toml_edit::Item::as_table_like)
        {
            for (key, value) in table.iter() {
                if self.items.len() >= ENTRY_LIMIT {
                    self.issue("resourceLimited", path);
                    break;
                }
                let Some(value) = value.as_table_like() else {
                    self.issue("configInvalid", path);
                    continue;
                };
                let state = match value.get("enabled").and_then(toml_edit::Item::as_bool) {
                    Some(false) => "disabled",
                    Some(true) => "enabled",
                    None => "configured",
                };
                let mut row = item(
                    path,
                    source,
                    project,
                    Kind::Mcp,
                    key.into(),
                    Some(key.into()),
                    state,
                    &text,
                    now,
                    Some(&file_hash),
                );
                row.bytes = None;
                row.bytes_source = None;
                row.characters = None;
                row.measurement_status = "schemaUnavailable".into();
                row.estimate_status = "schemaUnavailable".into();
                self.items.push(row);
            }
        }
        if let Some(events) = doc.get("hooks").and_then(toml_edit::Item::as_table_like) {
            for (event, groups) in events.iter() {
                if event == "state" {
                    continue;
                }
                let Some(groups) = hook_tables(groups) else {
                    self.issue("hookConfigInvalid", path);
                    continue;
                };
                for (group_index, group) in groups.iter().enumerate() {
                    let Some(handlers) = group.0.get("hooks").and_then(hook_tables) else {
                        self.issue("hookConfigInvalid", path);
                        continue;
                    };
                    for (handler_index, (_, span)) in handlers.iter().enumerate() {
                        if self.items.len() >= ENTRY_LIMIT {
                            self.issue("resourceLimited", path);
                            break;
                        }
                        let key = format!(
                            "/hooks/{}/{group_index}/hooks/{handler_index}",
                            event.replace('~', "~0").replace('/', "~1")
                        );
                        let mut row = item(
                            path,
                            source,
                            project,
                            Kind::Hook,
                            format!("{event} · {}.{}", group_index + 1, handler_index + 1),
                            Some(key),
                            "declared",
                            &text,
                            now,
                            Some(&file_hash),
                        );
                        self.hook_measurement(
                            &mut row,
                            span.clone().and_then(|range| text.get(range)),
                            path,
                        );
                        self.items.push(row);
                    }
                }
            }
            self.issue("hookEffectiveRegistryUnavailable", path);
        }
        // Profiles/plugin-injected definitions and effective precedence are not inferred.
        self.issue("effectiveConfigUnknown", path);
    }
}
type HookTable<'a> = (&'a dyn toml_edit::TableLike, Option<std::ops::Range<usize>>);
fn hook_tables(item: &toml_edit::Item) -> Option<Vec<HookTable<'_>>> {
    if let Some(tables) = item.as_array_of_tables() {
        return Some(
            tables
                .iter()
                .map(|table| {
                    (
                        table as &dyn toml_edit::TableLike,
                        declaration_span(table, table.span()),
                    )
                })
                .collect(),
        );
    }
    item.as_array()?
        .iter()
        .map(|value| {
            value
                .as_inline_table()
                .map(|table| (table as &dyn toml_edit::TableLike, table.span()))
        })
        .collect()
}
fn declaration_span(
    table: &dyn toml_edit::TableLike,
    header: Option<std::ops::Range<usize>>,
) -> Option<std::ops::Range<usize>> {
    let mut range = header?;
    for (_, item) in table.iter() {
        // A table span is its header, not its body. Flat handler values extend it;
        // unsupported nested tables do not become an invented contiguous slice.
        let span = item.as_value()?.span()?;
        range.end = range.end.max(span.end);
    }
    Some(range)
}
