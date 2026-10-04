//! Skip the native host unless local Hook declarations or explicitly enabled plugins exist.
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};
const FILE_LIMIT: usize = 10 * 1024 * 1024;
const ROUND_LIMIT: usize = 32 * 1024 * 1024;
pub(super) fn has_declarations(sources: &BTreeSet<PathBuf>, projects: &[String]) -> bool {
    let candidates = sources
        .iter()
        .flat_map(|root| {
            [
                (root.join("config.toml"), root.as_path()),
                (root.join("hooks.json"), root.as_path()),
            ]
        })
        .chain(projects.iter().flat_map(|project| {
            let root = Path::new(project);
            [
                (root.join(".codex/config.toml"), root),
                (root.join(".codex/hooks.json"), root),
            ]
        }));
    let mut used = 0;
    for (file, root) in candidates {
        let Ok(path) = dunce::canonicalize(file) else {
            continue;
        };
        if !path.starts_with(root) {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > FILE_LIMIT as u64 {
            continue;
        }
        if used + metadata.len() as usize > ROUND_LIMIT {
            break;
        }
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let mut bytes = Vec::new();
        let remaining = FILE_LIMIT.min(ROUND_LIMIT - used);
        let read = file.take(remaining as u64 + 1).read_to_end(&mut bytes);
        used += bytes.len();
        if bytes.len() > remaining {
            break;
        }
        if read.is_err() {
            continue;
        }
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        let present = if path.extension().is_some_and(|e| e == "toml") {
            toml_edit::Document::parse(text.as_str())
                .ok()
                .map(|doc| {
                    let hooks = doc
                        .get("hooks")
                        .and_then(toml_edit::Item::as_table_like)
                        .map(|table| table.iter().any(|(key, _)| key != "state"))
                        .unwrap_or(false);
                    let plugins = doc
                        .get("plugins")
                        .and_then(toml_edit::Item::as_table_like)
                        .is_some_and(|table| {
                            table.iter().any(|(_, value)| {
                                value
                                    .as_table_like()
                                    .and_then(|v| v.get("enabled"))
                                    .and_then(toml_edit::Item::as_bool)
                                    == Some(true)
                            })
                        });
                    hooks || plugins
                })
                .unwrap_or(false)
        } else {
            serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|doc| {
                    doc.get("hooks")
                        .and_then(serde_json::Value::as_object)
                        .map(|hooks| hooks.keys().any(|key| key != "state"))
                })
                .unwrap_or(false)
        };
        if present {
            return true;
        }
    }
    false
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_declaration_does_not_start_native_and_state_alone_is_not_a_hook() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let sources = BTreeSet::from([root.clone()]);
        assert!(!has_declarations(&sources, &[]));
        fs::write(
            root.join("config.toml"),
            "[mcp_servers.test]\ncommand='never-run'\n[hooks.state.one]\nenabled=true\n",
        )
        .unwrap();
        assert!(!has_declarations(&sources, &[]));
        fs::write(
            root.join("hooks.json"),
            r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"never-run"}]}]}}"#,
        )
        .unwrap();
        assert!(has_declarations(&sources, &[]));
    }
    #[test]
    fn plugin_preflight_requires_explicit_enablement() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let sources = BTreeSet::from([root.clone()]);
        for entry in [
            "",
            "enabled=false",
            "description='synthetic'",
            "enabled='true'",
        ] {
            fs::write(
                root.join("config.toml"),
                format!("[plugins.\"sample@test\"]\n{entry}\n"),
            )
            .unwrap();
            assert!(!has_declarations(&sources, &[]));
        }
        fs::write(
            root.join("config.toml"),
            "[plugins.\"sample@test\"]\nenabled=true\n",
        )
        .unwrap();
        assert!(has_declarations(&sources, &[]));
    }
}
