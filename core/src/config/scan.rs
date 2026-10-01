//! Bounded, allowlisted filesystem discovery. Configuration commands are never executed.
use super::super::config_dto::*;
use crate::adapters::contract::SourceInstance;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};
const FILE_LIMIT: u64 = 10 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 64 * 1024 * 1024;
const ENTRY_LIMIT: usize = 10_000;
#[derive(Default)]
pub(super) struct Inventory {
    pub items: Vec<Item>,
    pub issues: Vec<Issue>,
    used: u64,
    visited: BTreeSet<PathBuf>,
    examined: usize,
}
impl Inventory {
    fn issue(&mut self, code: &str, path: &Path) {
        if self.issues.len() < 256 {
            self.issues.push(Issue {
                code: code.into(),
                path: Some(path.to_string_lossy().into()),
            });
        }
    }
    fn read(&mut self, path: &Path, allowed: &Path) -> Option<String> {
        if self.used >= TOTAL_LIMIT || self.examined >= ENTRY_LIMIT {
            self.issue("resourceLimited", path);
            return None;
        }
        self.examined += 1;
        let canonical = match fs::canonicalize(path) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => {
                self.issue("configUnreadable", path);
                return None;
            }
        };
        if !canonical.starts_with(allowed) {
            self.issue("outsideAuthorizedRoot", path);
            return None;
        }
        let result = (|| -> std::io::Result<String> {
            if !fs::metadata(&canonical)?.is_file() {
                return Err(std::io::Error::other("not a file"));
            }
            let mut file = fs::File::open(&canonical)?;
            if !file.metadata()?.is_file() {
                return Err(std::io::Error::other("not a file"));
            }
            let max = FILE_LIMIT.min(TOTAL_LIMIT.saturating_sub(self.used));
            let mut buf = Vec::new();
            (&mut file).take(max + 1).read_to_end(&mut buf)?;
            self.used += buf.len() as u64;
            if buf.len() as u64 > max {
                return Err(std::io::Error::other("limit"));
            }
            String::from_utf8(buf).map_err(std::io::Error::other)
        })();
        match result {
            Ok(s) => Some(s),
            Err(e) => {
                self.issue(
                    if e.to_string() == "limit" {
                        "resourceLimited"
                    } else {
                        "configUnreadable"
                    },
                    path,
                );
                None
            }
        }
    }
    fn text_item(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        kind: Kind,
        now: &str,
    ) {
        if self.items.len() >= ENTRY_LIMIT {
            self.issue("resourceLimited", path);
            return;
        }
        if let Some(text) = self.read(path, allowed) {
            let name = if kind == Kind::Skill {
                path.parent().and_then(Path::file_name)
            } else {
                path.file_name()
            }
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
            self.items.push(item(
                path,
                source,
                project,
                kind,
                name,
                None,
                "discovered",
                &text,
                now,
            ));
        }
    }
    fn skills(
        &mut self,
        dir: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        now: &str,
        depth: usize,
    ) {
        if depth > 8 || self.examined >= ENTRY_LIMIT {
            self.issue("resourceLimited", dir);
            return;
        }
        let canonical = match fs::canonicalize(dir) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => {
                self.issue("configUnreadable", dir);
                return;
            }
        };
        if !canonical.starts_with(allowed) {
            self.issue("outsideAuthorizedRoot", dir);
            return;
        }
        if !self.visited.insert(canonical.clone()) {
            return;
        }
        if canonical.join("SKILL.md").exists() {
            self.text_item(
                &canonical.join("SKILL.md"),
                allowed,
                source,
                project,
                Kind::Skill,
                now,
            );
            return;
        }
        let entries = match fs::read_dir(&canonical) {
            Ok(e) => e,
            Err(_) => {
                self.issue("configUnreadable", dir);
                return;
            }
        };
        for entry in entries {
            self.examined += 1;
            if self.examined >= ENTRY_LIMIT {
                self.issue("resourceLimited", dir);
                break;
            }
            if let Ok(entry) = entry {
                if entry.path().is_dir() {
                    self.skills(&entry.path(), allowed, source, project, now, depth + 1);
                }
            } else {
                self.issue("configUnreadable", dir);
            }
        }
    }
    fn mcp(
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
        let doc = match text.parse::<toml_edit::DocumentMut>() {
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
                );
                row.bytes = None;
                row.estimate_status = "schemaUnavailable".into();
                self.items.push(row);
            }
        }
        // Profiles/plugin-injected definitions and effective precedence are not inferred.
        self.issue("effectiveConfigUnknown", path);
    }
}
#[allow(clippy::too_many_arguments)]
fn item(
    path: &Path,
    source: &SourceInstance,
    project: Option<&str>,
    kind: Kind,
    name: String,
    key: Option<String>,
    state: &str,
    text: &str,
    now: &str,
) -> Item {
    let path = path.to_string_lossy().into_owned();
    Item {
        id: crate::hash(format!(
            "{}:{path}:{kind:?}:{}",
            source.id,
            key.as_deref().unwrap_or("")
        )),
        name,
        kind,
        source_instance_id: source.id.clone(),
        path,
        project: project.map(str::to_owned),
        native_key: key,
        configured_state: state.into(),
        content_hash: crate::hash(text),
        observed_at: now.into(),
        current: true,
        stale: false,
        bytes: Some(text.len() as u64),
        content_tokens: None,
        estimate_status: "tokenizerUnavailable".into(),
        observation: Observation::Unknown,
        counts: Counts::default(),
        related_turns: 0,
        usage: None,
    }
}
pub(super) fn scan(sources: &[SourceInstance], projects: &[String], now: &str) -> Inventory {
    let mut out = Inventory::default();
    for source in sources {
        let root = match fs::canonicalize(&source.root) {
            Ok(p) => p,
            Err(_) => {
                out.issue("configUnreadable", Path::new(&source.root));
                PathBuf::from(&source.root)
            }
        };
        out.text_item(
            &root.join("AGENTS.md"),
            &root,
            source,
            None,
            Kind::Rule,
            now,
        );
        out.text_item(
            &root.join("AGENTS.override.md"),
            &root,
            source,
            None,
            Kind::Rule,
            now,
        );
        out.mcp(&root.join("config.toml"), &root, source, None, now);
        out.visited.clear();
        for dir in [root.join("skills"), root.join(".agents/skills")] {
            out.skills(&dir, &root, source, None, now, 0);
        }
        if fs::canonicalize(crate::home().join(".codex")).ok().as_ref() == Some(&root) {
            let dir = crate::home().join(".agents/skills");
            if let Ok(allowed) = fs::canonicalize(&dir) {
                out.skills(&dir, &allowed, source, None, now, 0);
            }
        }
        for project in projects {
            let root = Path::new(project);
            out.text_item(
                &root.join("AGENTS.md"),
                root,
                source,
                Some(project),
                Kind::Rule,
                now,
            );
            out.text_item(
                &root.join("AGENTS.override.md"),
                root,
                source,
                Some(project),
                Kind::Rule,
                now,
            );
            out.mcp(
                &root.join(".codex/config.toml"),
                root,
                source,
                Some(project),
                now,
            );
            out.visited.clear();
            out.skills(
                &root.join(".agents/skills"),
                root,
                source,
                Some(project),
                now,
                0,
            );
        }
    }
    out.items.sort_by(|a, b| a.id.cmp(&b.id));
    out.items.dedup_by(|a, b| a.id == b.id);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(root: &Path) -> SourceInstance {
        SourceInstance {
            id: "source".into(),
            agent_kind: "codex".into(),
            root: root.to_string_lossy().into_owned(),
        }
    }
    #[test]
    fn inventory_only_exposes_metadata_and_never_runs_commands() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        fs::create_dir_all(root.join("skills/review")).unwrap();
        fs::write(root.join("skills/review/SKILL.md"), "合成规则").unwrap();
        fs::write(root.join("config.toml"), "[mcp_servers.example]\ncommand = 'SYNTHETIC_SECRET_COMMAND'\nenv = { TOKEN = 'SYNTHETIC_SECRET_VALUE' }\nenabled = false\n").unwrap();
        let result = scan(&[source(&root)], &[], "now");
        assert_eq!(result.items.len(), 2);
        let skill = result.items.iter().find(|i| i.kind == Kind::Skill).unwrap();
        assert_eq!(skill.bytes, Some("合成规则".len() as u64));
        assert_eq!(skill.content_tokens, None);
        assert_eq!(skill.observation, Observation::Unknown);
        let mcp = result.items.iter().find(|i| i.kind == Kind::Mcp).unwrap();
        assert_eq!(mcp.configured_state, "disabled");
        assert_eq!(mcp.bytes, None);
        let text = serde_json::to_string(&result.items).unwrap();
        assert!(!text.contains("SYNTHETIC_SECRET"));
        assert!(!text.contains("合成规则"));
    }
    #[test]
    fn malformed_and_oversized_files_are_explicit_gaps() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        fs::write(root.join("config.toml"), "[broken").unwrap();
        fs::write(root.join("AGENTS.md"), vec![b'x'; FILE_LIMIT as usize + 1]).unwrap();
        let result = scan(&[source(&root)], &[], "now");
        assert!(result.items.is_empty());
        assert!(result.issues.iter().any(|i| i.code == "configInvalid"));
        assert!(result.issues.iter().any(|i| i.code == "resourceLimited"));
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_the_authorized_root_or_recurse_forever() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("AGENTS.md"), "private").unwrap();
        std::os::unix::fs::symlink(outside.path().join("AGENTS.md"), root.join("AGENTS.md"))
            .unwrap();
        fs::create_dir(root.join("skills")).unwrap();
        std::os::unix::fs::symlink(root.join("skills"), root.join("skills/loop")).unwrap();
        let result = scan(&[source(&root)], &[], "now");
        assert!(result.items.is_empty());
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "outsideAuthorizedRoot")
        );
    }
}
