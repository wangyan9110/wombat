//! Exact instruction entries and Skill-directory discovery.
use super::*;
impl Inventory {
    pub(super) fn agents(
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
    pub(super) fn skills(
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
}
