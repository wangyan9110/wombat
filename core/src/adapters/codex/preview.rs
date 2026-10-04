//! Bounded, ephemeral task headers while the authoritative scan is still running.
use super::*;
use std::io::BufRead;
use std::time::{Duration, Instant};

const FILES: usize = 64;
const DIRECTORIES: usize = 128;
const ENTRIES: usize = 2048;
const HEADER_BYTES: u64 = 128 * 1024;
pub(crate) const ISSUE: &str = "initialScanIncomplete";

pub(crate) fn collect(discovery: DiscoveryReport) -> Collected {
    let mut collected = Collected {
        issues: discovery.issues,
        ..Default::default()
    };
    let mut budget = Budget {
        files: FILES,
        directories: DIRECTORIES,
        entries: ENTRIES,
        deadline: Instant::now() + Duration::from_millis(100),
    };
    for source in discovery.sources {
        let descriptor = CodexAdapter.descriptor();
        let issue = Issue {
            code: ISSUE.into(),
            message: "首次扫描尚未完成；当前仅含有限任务元数据，用量与活动范围未知".into(),
            source_instance_id: Some(source.id.clone()),
            evidence: None,
        };
        let mut report = SourceReport {
            source: source.clone(),
            adapter_version: descriptor.adapter_version,
            capabilities: descriptor.capabilities,
            source_versions: vec![],
            status: "partial".into(),
            files_read: 0,
            bytes_read: 0,
            issues: vec![issue.clone()],
        };
        let mut facts = Facts::default();
        for directory in ["sessions", "archived_sessions"] {
            walk(
                &Path::new(&source.root).join(directory),
                0,
                &source,
                &mut budget,
                &mut report,
                &mut facts,
            );
        }
        // Repeated headers can disagree about cwd. Do not invent an attribution.
        for (id, projects) in &facts.projects {
            if projects.len() > 1
                && let Some(thread) = facts.threads.get_mut(id)
            {
                thread.project = None;
            }
        }
        collected.threads.extend(facts.threads.into_values());
        collected.issues.push(issue);
        collected.sources.push(report);
    }
    collected
}

struct Budget {
    files: usize,
    directories: usize,
    entries: usize,
    deadline: Instant,
}
impl Budget {
    fn exhausted(&self) -> bool {
        self.files == 0 || self.entries == 0 || Instant::now() >= self.deadline
    }
}
fn walk(
    path: &Path,
    depth: usize,
    source: &SourceInstance,
    budget: &mut Budget,
    report: &mut SourceReport,
    facts: &mut Facts,
) {
    if budget.exhausted() || budget.directories == 0 || depth > 64 {
        return;
    }
    budget.directories -= 1;
    // Including the top-level sessions directory: never follow directory links.
    if !fs::symlink_metadata(path).is_ok_and(|m| m.is_dir()) {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries {
        if budget.exhausted() {
            break;
        }
        budget.entries -= 1;
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            walk(&path, depth + 1, source, budget, report, facts);
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            budget.files -= 1;
            header(&path, source, report, facts);
        }
    }
}
fn header(path: &Path, source: &SourceInstance, report: &mut SourceReport, facts: &mut Facts) {
    let Ok(file) = File::open(path) else {
        return;
    };
    let Ok(before) = file.metadata() else {
        return;
    };
    if !before.is_file() {
        return;
    }
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(file.take(HEADER_BYTES));
    let Ok(size) = reader.read_until(b'\n', &mut bytes) else {
        return;
    };
    report.files_read += 1;
    report.bytes_read += size as u64;
    // A skipped header is not a skipped source record: the full reader follows.
    let Ok(after) = reader.get_ref().get_ref().metadata() else {
        return;
    };
    if bytes.last() != Some(&b'\n') || file_changed(&before, &after) {
        return;
    }
    let Ok(envelope) = serde_json::from_slice::<Envelope<'_>>(&bytes) else {
        return;
    };
    if envelope.kind != "session_meta" {
        return;
    }
    let Ok(payload) = serde_json::from_str::<Payload<'_>>(envelope.payload.get()) else {
        return;
    };
    if let Some(id) = payload
        .id
        .as_deref()
        .or(payload.session_id.as_deref())
        .filter(|id| !id.is_empty())
    {
        facts.project_thread(
            &source.id,
            id,
            timestamp(envelope.timestamp).as_deref(),
            payload.cwd.as_deref(),
        );
        if let Some(version) = payload.cli_version {
            let version = safe_text(&version);
            if !report.source_versions.contains(&version) {
                report.source_versions.push(version);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn discovery(root: &Path) -> DiscoveryReport {
        CodexAdapter.discover(&DiscoveryRequest {
            roots: vec![root.into()],
        })
    }
    fn record(id: &str, cwd: &str, padding: &str) -> String {
        format!(
            "{}\n",
            json!({"type":"session_meta","timestamp":"2026-10-01T01:02:03Z","payload":{"id":id,"cwd":cwd,"cli_version":"synthetic","instructions":padding}})
        )
    }

    #[test]
    fn preview_retains_only_headers_with_full_scan_identities() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sessions")).unwrap();
        let path = dir.path().join("sessions/task.jsonl");
        fs::write(
            &path,
            record("native-task", "/fixture/project", "private synthetic text"),
        )
        .unwrap();
        let value = collect(discovery(dir.path()));
        assert_eq!(value.threads.len(), 1);
        assert!(value.measurements.is_empty() && value.operations.is_empty());
        assert_eq!(value.sources[0].status, "partial");
        assert_eq!(value.issues[0].code, ISSUE);
        let mut full = Collected::default();
        CodexAdapter.collect(
            &discovery(dir.path()).sources[0],
            &ReadPlan,
            &RunContext::default(),
            &mut full,
        );
        assert_eq!(value.threads[0].id, full.threads[0].id);
        assert_eq!(value.threads[0].project, full.threads[0].project);
        assert!(
            !serde_json::to_string(&value)
                .unwrap()
                .contains("private synthetic text")
        );
    }

    #[test]
    fn oversized_and_unfinished_headers_remain_available_to_full_reader() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sessions")).unwrap();
        let path = dir.path().join("sessions/large.jsonl");
        fs::write(
            &path,
            record("large", "/fixture", &"x".repeat(HEADER_BYTES as usize)),
        )
        .unwrap();
        fs::write(
            dir.path().join("sessions/tail.jsonl"),
            record("tail", "/fixture", "").trim_end(),
        )
        .unwrap();
        let value = collect(discovery(dir.path()));
        assert!(value.threads.is_empty());
        assert!(value.sources[0].bytes_read <= 2 * HEADER_BYTES);
        let mut full = Collected::default();
        CodexAdapter.collect(
            &discovery(dir.path()).sources[0],
            &ReadPlan,
            &RunContext::default(),
            &mut full,
        );
        assert!(full.threads.iter().any(|t| t.upstream_id == "large"));
    }

    #[test]
    fn file_budget_is_shared_across_sources_and_conflicting_projects_are_unknown() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sessions")).unwrap();
        for i in 0..100 {
            fs::write(
                dir.path().join(format!("sessions/{i}.jsonl")),
                record("same", &format!("/fixture/{i}"), ""),
            )
            .unwrap();
        }
        let second = tempfile::tempdir().unwrap();
        fs::create_dir(second.path().join("sessions")).unwrap();
        fs::write(
            second.path().join("sessions/one.jsonl"),
            record("second", "/fixture", ""),
        )
        .unwrap();
        let mut discovered = discovery(dir.path());
        discovered.sources.extend(discovery(second.path()).sources);
        let value = collect(discovered);
        assert!(value.sources.iter().map(|s| s.files_read).sum::<u64>() <= FILES as u64);
        assert!(
            value.sources.iter().map(|s| s.bytes_read).sum::<u64>() <= FILES as u64 * HEADER_BYTES
        );
        assert!(value.threads.len() <= 1);
        if value.sources[0].files_read > 1 {
            assert!(value.threads[0].project.is_none());
        }
    }
}
