//! Parse each authorized declaration file once; keep only bounded static path facts.
use super::command::{Script, script};
use crate::config_dto::Item;
use std::{collections::BTreeMap, fs, io::Read, path::Path};
fn table(item: &toml_edit::Item, index: usize) -> Option<&dyn toml_edit::TableLike> {
    if let Some(array) = item.as_array_of_tables() {
        return array.get(index).map(|t| t as &dyn toml_edit::TableLike);
    }
    item.as_array()?
        .get(index)?
        .as_inline_table()
        .map(|t| t as &dyn toml_edit::TableLike)
}
fn toml_command<'a>(doc: &'a toml_edit::Document<&str>, key: &str) -> Option<&'a str> {
    let parts: Vec<_> = key.split('/').collect();
    if parts.len() != 6 || parts[1] != "hooks" || parts[4] != "hooks" {
        return None;
    }
    let event = doc.get("hooks")?.as_table_like()?.get(parts[2])?;
    let group = table(event, parts[3].parse().ok()?)?;
    let handler = table(group.get("hooks")?, parts[5].parse().ok()?)?;
    if handler.get("type")?.as_str()? != "command" {
        return None;
    }
    handler.get("command")?.as_str()
}
pub(super) fn read<'a>(
    items: impl Iterator<Item = &'a Item>,
    roots: &[String],
) -> BTreeMap<&'a str, Option<Script>> {
    let mut files: BTreeMap<&str, Vec<&Item>> = BTreeMap::new();
    for item in items {
        files.entry(&item.path).or_default().push(item);
    }
    let mut output = BTreeMap::new();
    let mut used = 0;
    for (path, members) in files {
        if used >= 32 * 1024 * 1024 {
            break;
        }
        let Ok(canonical) = dunce::canonicalize(path) else {
            continue;
        };
        if canonical != Path::new(path) || !roots.iter().any(|root| canonical.starts_with(root)) {
            continue;
        }
        if !fs::metadata(&canonical).is_ok_and(|m| m.is_file()) {
            continue;
        }
        let Ok(file) = fs::File::open(&canonical) else {
            continue;
        };
        let limit = (10 * 1024 * 1024).min(32 * 1024 * 1024 - used);
        let mut bytes = Vec::new();
        let result = file.take(limit as u64 + 1).read_to_end(&mut bytes);
        used += bytes.len();
        if result.is_err() || bytes.len() > limit {
            continue;
        }
        let hash = crate::hash(&bytes);
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        if Path::new(path).extension().is_some_and(|s| s == "toml") {
            let Ok(doc) = toml_edit::Document::parse(text.as_str()) else {
                continue;
            };
            for item in members.into_iter().filter(|i| i.content_hash == hash) {
                if let Some(command) = item
                    .native_key
                    .as_deref()
                    .and_then(|key| toml_command(&doc, key))
                {
                    output.insert(item.id.as_str(), script(command));
                }
            }
        } else {
            let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            for item in members.into_iter().filter(|i| i.content_hash == hash) {
                let command = item
                    .native_key
                    .as_deref()
                    .and_then(|key| doc.pointer(key))
                    .filter(|h| h.get("type").and_then(|v| v.as_str()) == Some("command"))
                    .and_then(|h| h.get("command"))
                    .and_then(|v| v.as_str());
                if let Some(command) = command {
                    output.insert(item.id.as_str(), script(command));
                }
            }
        }
    }
    output
}
