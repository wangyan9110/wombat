//! Allowlisted bounded reads and whole-file measurements.
use super::*;
impl Inventory {
    pub(super) fn issue(&mut self, code: &str, path: &Path) {
        if self.issues.len() < 256 {
            self.issues.push(Issue {
                code: code.into(),
                path: Some(path.to_string_lossy().into()),
            });
        }
    }
    pub(super) fn read(&mut self, path: &Path, allowed: &Path) -> Option<String> {
        if self.used >= TOTAL_LIMIT || self.examined >= ENTRY_LIMIT {
            self.issue("resourceLimited", path);
            return None;
        }
        self.examined += 1;
        let canonical = match dunce::canonicalize(path) {
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
            Ok(s) => {
                self.read_paths.insert(path.to_string_lossy().into_owned());
                Some(s)
            }
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
    pub(super) fn text_item(
        &mut self,
        path: &Path,
        allowed: &Path,
        source: &SourceInstance,
        project: Option<&str>,
        kind: Kind,
        now: &str,
    ) {
        self.authorized_roots
            .insert(allowed.to_string_lossy().into_owned());
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
                None,
            );
            row.characters = Some(text.chars().count() as u64);
            if kind == Kind::Skill {
                let directory = dunce::canonicalize(path)
                    .is_ok_and(|canonical| canonical == path)
                    .then_some(row.name.as_str());
                let (metadata, body) = crate::config::measure::skill_in_directory(&text, directory);
                row.body_estimate_status = metadata.status.clone();
                if let Some(body) = body {
                    let limited = body.len() > crate::config::measure::ESTIMATE_FILE_LIMIT
                        || self.estimated.saturating_add(body.len())
                            > crate::config::measure::ESTIMATE_ROUND_LIMIT;
                    if !limited {
                        self.estimated += body.len();
                        row.body_token_estimate =
                            crate::config::measure::estimate(body, &crate::hash(body));
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
            let limited = text.len() > crate::config::measure::ESTIMATE_FILE_LIMIT
                || self.estimated.saturating_add(text.len())
                    > crate::config::measure::ESTIMATE_ROUND_LIMIT;
            if !limited {
                self.estimated += text.len();
                row.estimate = crate::config::measure::estimate(&text, &row.content_hash);
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
            let safe = dunce::canonicalize(path)
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
                None,
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
}
