//! Registration identities validated independently of native version, command text or cache layout.
use super::{CapturedHook, event};
use std::path::Path;

fn plugin_id(id: &str) -> bool {
    let Some((name, marketplace)) = id.split_once('@') else {
        return false;
    };
    id.len() <= 256
        && !name.is_empty()
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.contains("..")
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        && !marketplace.is_empty()
        && marketplace
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}

pub(in crate::config) fn declaration(h: &CapturedHook) -> Option<Vec<String>> {
    let (native, public) = event(&h.event_name)?;
    let (source_event, handler) = h.key.rsplit_once(':')?;
    let (source_event, group) = source_event.rsplit_once(':')?;
    let (source, key_event) = source_event.rsplit_once(':')?;
    if native != key_event || h.key.len() > 4096 {
        return None;
    }
    let index = |s: &str| s.parse::<usize>().ok().filter(|n| n.to_string() == s);
    let (group, handler) = (index(group)?, index(handler)?);
    if h.source == "plugin" {
        let id = h.plugin_id.as_deref().filter(|id| plugin_id(id))?;
        let relative = source.strip_prefix(id)?.strip_prefix(':')?;
        if let Some(inline) = relative
            .strip_prefix("plugin.json#hooks[")
            .and_then(|s| s.strip_suffix(']'))
        {
            let document = index(inline)?;
            if Path::new(&h.source_path).file_name()? != "plugin.json"
                || !Path::new(&h.source_path).is_absolute()
            {
                return None;
            }
            let mut pointers = vec![format!(
                "/hooks/{document}/hooks/{public}/{group}/hooks/{handler}"
            )];
            if document == 0 {
                pointers.push(format!("/hooks/hooks/{public}/{group}/hooks/{handler}"));
            }
            return Some(pointers);
        }
        // Native keys use package-relative slash paths. Never normalize traversal or guess a root.
        if relative.is_empty()
            || relative.contains(['\\', ':'])
            || relative
                .split('/')
                .any(|s| s.is_empty() || matches!(s, "." | ".."))
            || !Path::new(&h.source_path).is_absolute()
            || !Path::new(&h.source_path).ends_with(relative)
        {
            return None;
        }
    } else if h.plugin_id.is_some() || source != h.source_path {
        return None;
    }
    Some(vec![format!("/hooks/{public}/{group}/hooks/{handler}")])
}
