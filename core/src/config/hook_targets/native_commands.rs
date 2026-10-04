//! Native-expanded commands remain ephemeral and bind to the exact public registration version.
use super::command::{Script, script};
use crate::{config::hooks, config_dto::HookRegistry};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn read<'a>(
    capture: Option<&'a hooks::Capture>,
    registry: &HookRegistry,
) -> BTreeMap<(&'a str, &'a str), Script> {
    let Some(capture) = capture.filter(|c| hooks::valid(c)) else {
        return BTreeMap::new();
    };
    let bound: BTreeMap<_, _> = registry
        .contexts
        .iter()
        .flat_map(|c| {
            c.registrations
                .iter()
                .map(move |r| ((c.project.as_str(), r.native_key.as_str()), r))
        })
        .collect();
    let mut output = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for context in &capture.contexts {
        if !seen.insert(&context.cwd) {
            continue;
        }
        let mut keys = BTreeMap::new();
        for hook in &context.hooks {
            *keys.entry(&hook.key).or_insert(0) += 1;
        }
        for hook in &context.hooks {
            let key = (context.cwd.as_str(), hook.key.as_str());
            let Some(registration) = bound.get(&key) else {
                continue;
            };
            if hook.source != "plugin"
                || keys.get(&hook.key) != Some(&1)
                || registration.source != hook.source
                || registration.plugin_id != hook.plugin_id
                || registration.content_hash != hook.source_hash
                || registration.registration_hash != hook.current_hash
                || registration.enabled != hook.enabled
                || registration.trust != hook.trust_status
                || registration.handler != hook.handler_type
            {
                continue;
            }
            if let Some(script) = hook.command.as_deref().and_then(script) {
                output.insert(key, script);
            }
        }
    }
    output
}
