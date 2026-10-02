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
// Case-insensitive filesystems still need an exact product entry name.
fn exact_entry(path: &Path) -> std::io::Result<bool> {
    let entries = fs::read_dir(
        path.parent()
            .ok_or_else(|| std::io::Error::other("parent"))?,
    )?;
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::other("name"))?;
    for (n, entry) in entries.enumerate() {
        if n >= ENTRY_LIMIT {
            return Err(std::io::Error::other("limit"));
        }
        let entry = entry?;
        if entry.file_name() == name {
            return Ok(true);
        }
    }
    Ok(false)
}
#[derive(Default)]
pub(super) struct Inventory {
    pub items: Vec<Item>,
    pub issues: Vec<Issue>,
    used: u64,
    visited: BTreeSet<PathBuf>,
    examined: usize,
    estimated: usize,
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
        let exact = exact_entry(path);
        if let Err(e) = &exact
            && e.kind() != std::io::ErrorKind::NotFound
        {
            self.issue(
                if e.to_string() == "limit" {
                    "resourceLimited"
                } else {
                    "configUnreadable"
                },
                path,
            );
        }
        if let Some(text) = if exact.as_ref().is_ok_and(|found| *found) {
            self.read(path, allowed)
        } else {
            None
        } {
            let name = if kind == Kind::Skill {
                path.parent().and_then(Path::file_name)
            } else {
                path.file_name()
            }
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
            let mut row = item(
                path,
                source,
                project,
                kind.clone(),
                name,
                None,
                "discovered",
                &text,
                now,
            );
            row.characters = Some(text.chars().count() as u64);
            if kind == Kind::Skill {
                let (metadata, body) = super::measure::skill_with_body(&text);
                row.body_estimate_status = metadata.status.clone();
                if let Some(body) = body {
                    let limited = body.len() > super::measure::ESTIMATE_FILE_LIMIT
                        || self.estimated.saturating_add(body.len())
                            > super::measure::ESTIMATE_ROUND_LIMIT;
                    if !limited {
                        self.estimated += body.len();
                        row.body_token_estimate =
                            super::measure::estimate(body, &crate::hash(body));
                        if let Some(e) = &mut row.body_token_estimate {
                            e.payload = "skillBody".into();
                        }
                    }
                    row.body_estimate_status = if row.body_token_estimate.is_some() {
                        "estimated"
                    } else if limited {
                        "resourceLimited"
                    } else {
                        "estimateUnavailable"
                    }
                    .into();
                    if row.body_token_estimate.is_none() {
                        self.issue("bodyEstimateUnavailable", path);
                    }
                }
                row.skill_metadata = Some(metadata);
                if row
                    .skill_metadata
                    .as_ref()
                    .is_some_and(|m| matches!(m.status.as_str(), "resourceLimited" | "unsupported"))
                {
                    self.issue("skillMetadataUnavailable", path);
                }
            }
            let limited = text.len() > super::measure::ESTIMATE_FILE_LIMIT
                || self.estimated.saturating_add(text.len()) > super::measure::ESTIMATE_ROUND_LIMIT;
            if !limited {
                self.estimated += text.len();
                row.estimate = super::measure::estimate(&text, &row.content_hash);
            }
            row.content_tokens = row.estimate.as_ref().map(|e| e.tokens);
            row.estimate_status = if row.estimate.is_some() {
                "estimated"
            } else if limited {
                "resourceLimited"
            } else {
                "estimateUnavailable"
            }
            .into();
            if row.estimate.is_none() {
                self.issue(
                    if limited {
                        "estimateLimited"
                    } else {
                        "estimateUnavailable"
                    },
                    path,
                );
            }
            self.items.push(row);
        } else {
            let safe = fs::canonicalize(path)
                .ok()
                .filter(|p| p.starts_with(allowed) && exact.as_ref().is_ok_and(|found| *found));
            let metadata = safe
                .as_ref()
                .and_then(|p| fs::metadata(p).ok())
                .filter(|m| m.is_file());
            let missing = exact.as_ref().is_ok_and(|found| !*found)
                || fs::symlink_metadata(path)
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound);
            let name = if kind == Kind::Skill {
                path.parent().and_then(Path::file_name)
            } else {
                path.file_name()
            }
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
            let mut row = item(
                path,
                source,
                project,
                kind,
                name,
                None,
                if missing { "missing" } else { "unreadable" },
                "",
                now,
            );
            row.content_hash.clear();
            row.characters = None;
            row.bytes = metadata.map(|m| m.len());
            row.bytes_source = row.bytes.map(|_| "filesystemMetadata".into());
            row.measurement_status = if missing { "missing" } else { "unavailable" }.into();
            row.estimate_status = "contentUnavailable".into();
            self.items.push(row);
        }
    }
    fn agents(
        &mut self,
        dir: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: &str,
        now: &str,
        depth: usize,
    ) {
        if depth > 8 || self.examined >= ENTRY_LIMIT {
            self.issue("resourceLimited", dir);
            return;
        }
        if !self.visited.insert(dir.to_owned()) {
            return;
        }
        if depth == 0 || exact_entry(&dir.join("AGENTS.md")).is_ok_and(|found| found) {
            self.text_item(
                &dir.join("AGENTS.md"),
                allowed,
                source,
                Some(project),
                Kind::Rule,
                now,
            );
        }
        let Ok(entries) = fs::read_dir(dir) else {
            self.issue("configUnreadable", dir);
            return;
        };
        for entry in entries {
            self.examined += 1;
            if self.examined >= ENTRY_LIMIT {
                self.issue("resourceLimited", dir);
                break;
            }
            let Ok(entry) = entry else {
                self.issue("configUnreadable", dir);
                continue;
            };
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(".git" | "node_modules" | "target" | "dist" | ".codex" | ".agents")
            ) {
                continue;
            }
            if entry
                .file_type()
                .is_ok_and(|t| t.is_dir() && !t.is_symlink())
            {
                self.agents(&entry.path(), allowed, source, project, now, depth + 1);
            }
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
                row.bytes_source = None;
                row.characters = None;
                row.measurement_status = "schemaUnavailable".into();
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
        kind: kind.clone(),
        source_instance_id: source.id.clone(),
        path,
        project: project.map(str::to_owned),
        authorized_projects: project.into_iter().map(str::to_owned).collect(),
        source_contexts: vec![],
        native_key: key,
        configured_state: state.into(),
        content_hash: crate::hash(text),
        observed_at: now.into(),
        current: true,
        stale: false,
        bytes: Some(text.len() as u64),
        content_tokens: None,
        estimate_status: "tokenizerUnavailable".into(),
        characters: None,
        measurement_status: "complete".into(),
        bytes_source: Some("utf8Payload".into()),
        estimate: None,
        skill_metadata: None,
        body_token_estimate: None,
        body_estimate_status: "unknown".into(),
        usage_count: None,
        last_record_at: None,
        observation: Observation::Unknown,
        counts: Counts::default(),
        related_turns: 0,
        usage: None,
    }
}
fn source_context(row: &Item, source_id: String) -> SourceContext {
    SourceContext {
        inventory_id: crate::hash(format!(
            "{}:{}:{:?}:{}",
            source_id,
            row.path,
            row.kind,
            row.native_key.as_deref().unwrap_or("")
        )),
        source_instance_id: source_id,
        content_hash: row.content_hash.clone(),
        configured_state: row.configured_state.clone(),
        global: row.project.is_none(),
        counts: Counts::default(),
        observation: Observation::Unknown,
        last_record_at: None,
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
    }
    for row in &mut out.items {
        row.source_contexts = vec![source_context(row, row.source_instance_id.clone())];
    }
    if let Some(source) = sources.first() {
        for project in projects {
            let first = out.items.len();
            let root = Path::new(project);
            out.visited.clear();
            out.agents(root, root, source, project, now, 0);
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
            for row in &mut out.items[first..] {
                row.source_contexts = sources
                    .iter()
                    .map(|s| source_context(row, s.id.clone()))
                    .collect();
            }
        }
    }
    out.items.sort_by(|a, b| a.id.cmp(&b.id));
    out.items.dedup_by(|a, b| {
        if a.id != b.id {
            return false;
        }
        b.source_contexts.extend(a.source_contexts.iter().cloned());
        b.authorized_projects
            .extend(a.authorized_projects.iter().cloned());
        b.authorized_projects.sort();
        b.authorized_projects.dedup();
        if a.project.as_ref().is_some_and(|p| {
            b.project.as_ref().is_none_or(|old| {
                Path::new(p).components().count() > Path::new(old).components().count()
            })
        }) {
            b.project.clone_from(&a.project);
        }
        true
    });
    super::identity::aggregate(&mut out.items, &mut out.issues);
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
        assert_eq!(result.items.len(), 3);
        let skill = result.items.iter().find(|i| i.kind == Kind::Skill).unwrap();
        assert_eq!(skill.bytes, Some("合成规则".len() as u64));
        assert!(skill.content_tokens.is_some());
        assert_eq!(skill.characters, Some(4));
        assert_eq!(
            skill.estimate.as_ref().unwrap().content_hash,
            skill.content_hash
        );
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
        assert_eq!(result.items.len(), 1);
        let row = &result.items[0];
        assert_eq!(row.bytes, Some(FILE_LIMIT + 1));
        assert_eq!(row.bytes_source.as_deref(), Some("filesystemMetadata"));
        assert_eq!(row.measurement_status, "unavailable");
        assert!(
            row.characters.is_none() && row.content_tokens.is_none() && row.content_hash.is_empty()
        );
        assert!(result.issues.iter().any(|i| i.code == "configInvalid"));
        assert!(result.issues.iter().any(|i| i.code == "resourceLimited"));
    }
    #[test]
    fn shared_projects_scan_once_and_keep_global_scope_specific_to_each_source() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let project = root.join("project");
        let second_root = root.join("second");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        let text = "合成当前完整规则。\n";
        fs::write(project.join("AGENTS.md"), text).unwrap();
        let first = SourceInstance {
            id: "first".into(),
            agent_kind: "codex".into(),
            root: project.to_string_lossy().into(),
        };
        let second = SourceInstance {
            id: "second".into(),
            agent_kind: "codex".into(),
            root: second_root.to_string_lossy().into(),
        };
        let projects = vec![project.to_string_lossy().into_owned()];
        let single = scan(std::slice::from_ref(&second), &projects, "now");
        let both = scan(&[second.clone(), first.clone()], &projects, "now");
        let object = both
            .items
            .iter()
            .find(|i| i.path == project.join("AGENTS.md").to_string_lossy())
            .unwrap();
        assert_eq!(object.source_contexts.len(), 2);
        assert!(object.applies(Some("first"), Some("/independent")));
        assert!(!object.applies(Some("second"), Some("/independent")));
        assert!(object.applies(Some("second"), Some(&projects[0])));
        let reverse = scan(&[first, second], &projects, "now");
        let same = reverse.items.iter().find(|i| i.id == object.id).unwrap();
        assert_eq!(same.source_instance_id, object.source_instance_id);
        assert_eq!(
            serde_json::to_value(&same.source_contexts).unwrap(),
            serde_json::to_value(&object.source_contexts).unwrap()
        );
        assert_eq!(single.used, text.len() as u64);
        // One global read plus one shared project read; no project read per source.
        assert_eq!(both.used, 2 * text.len() as u64);
        for c in &object.source_contexts {
            assert!(object.inventory_ids().any(|id| id == c.inventory_id));
        }
    }
    #[test]
    fn overlapping_roots_keep_one_object_with_both_authorized_memberships() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let project = root.join("project");
        let child = project.join("child");
        fs::create_dir_all(&child).unwrap();
        fs::write(child.join("AGENTS.md"), "完整合成指令。\n").unwrap();
        let roots = vec![
            project.to_string_lossy().into_owned(),
            child.to_string_lossy().into_owned(),
        ];
        let result = scan(&[source(&root)], &roots, "now");
        let found: Vec<_> = result
            .items
            .iter()
            .filter(|i| i.path == child.join("AGENTS.md").to_string_lossy())
            .collect();
        assert_eq!(found.len(), 1);
        let item = found[0];
        assert_eq!(item.project.as_ref(), Some(&roots[1]));
        assert_eq!(item.authorized_projects, roots);
        assert!(item.applies(None, Some(&roots[0])) && item.applies(None, Some(&roots[1])));
        assert!(!item.applies(None, Some("/unauthorized")));
        let reverse = scan(
            &[source(&root)],
            &[roots[1].clone(), roots[0].clone()],
            "now",
        );
        let same = reverse.items.iter().find(|i| i.id == item.id).unwrap();
        assert_eq!(same.authorized_projects, item.authorized_projects);
        assert_eq!(same.project, item.project);
    }
    #[test]
    fn recursive_agents_exact_names_and_measurement_states() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let project = root.join("project");
        fs::create_dir_all(project.join("nested")).unwrap();
        fs::create_dir_all(project.join("node_modules/example")).unwrap();
        fs::write(project.join("AGENTS.md"), "").unwrap();
        fs::write(project.join("nested/AGENTS.md"), "你好\r\n").unwrap();
        fs::create_dir(project.join("lowercase")).unwrap();
        fs::write(project.join("lowercase/agents.md"), "wrong").unwrap();
        fs::write(project.join("nested/AGENTS.override.md"), "wrong").unwrap();
        fs::write(project.join("node_modules/example/AGENTS.md"), "excluded").unwrap();
        let result = scan(&[source(&root)], &[project.to_string_lossy().into()], "now");
        let rows = result
            .items
            .iter()
            .filter(|i| i.project.is_some())
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 2);
        let empty = rows
            .iter()
            .find(|i| i.path == project.join("AGENTS.md").to_string_lossy())
            .unwrap();
        assert_eq!(empty.bytes, Some(0));
        assert_eq!(empty.characters, Some(0));
        assert_eq!(empty.content_tokens, Some(0));
        assert_eq!(empty.measurement_status, "complete");
        let unicode = rows
            .iter()
            .find(|i| i.path.ends_with("nested/AGENTS.md"))
            .unwrap();
        assert_eq!(unicode.bytes, Some(8));
        assert_eq!(unicode.characters, Some(4));
        fs::write(project.join("AGENTS.md"), [255, 254]).unwrap();
        let invalid = scan(&[source(&root)], &[project.to_string_lossy().into()], "now");
        let invalid = invalid.items.iter().find(|i| i.path == empty.path).unwrap();
        assert_eq!(invalid.bytes, Some(2));
        assert!(
            invalid.characters.is_none()
                && invalid.content_tokens.is_none()
                && invalid.content_hash.is_empty()
        );
        fs::remove_file(project.join("AGENTS.md")).unwrap();
        let missing = scan(&[source(&root)], &[project.to_string_lossy().into()], "now");
        let missing = missing.items.iter().find(|i| i.path == empty.path).unwrap();
        assert_eq!(missing.measurement_status, "missing");
        assert_eq!(missing.bytes, None);
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
        assert_eq!(result.items.len(), 1);
        assert!(result.items[0].bytes.is_none());
        assert!(result.items[0].content_hash.is_empty());
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "outsideAuthorizedRoot")
        );
    }
}
