//! Independent Codex rollout adapter. Only explicit identities merge facts.
mod ancestry;
pub(crate) mod incremental;
mod instructions;
mod operations;
pub(crate) mod preview;
mod skills;
#[cfg(test)]
mod tests;
mod timing;
mod wire;
use operations::{empty_operation, operation};

use super::{contract::*, stable_id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    env,
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
};
use wire::*;

pub const VERSION: &str = "codex-rollout-6";
pub struct CodexAdapter;

impl AgentAdapter for CodexAdapter {
    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor {
            agent_kind: "codex".into(),
            adapter_version: VERSION.into(),
            capabilities: Capabilities {
                usage: true,
                threads: true,
                turns: true,
                operations: true,
                reasoning_effort: true,
                response_identity: true,
                measurement_grain: vec!["response".into(), "interval".into()],
            },
        }
    }

    fn discover(&self, request: &DiscoveryRequest) -> DiscoveryReport {
        let mut roots = if request.roots.is_empty() {
            vec![
                env::var_os("CODEX_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| crate::home().join(".codex")),
            ]
        } else {
            request.roots.clone()
        };
        let mut result = DiscoveryReport::default();
        if request.roots.is_empty() {
            match crate::directories::authorized(crate::directories::Purpose::Source) {
                Ok(paths) => roots.extend(paths.into_iter().map(PathBuf::from)),
                Err(_) => result.issues.push(Issue {
                    code: "authorizationUnavailable".into(),
                    message: "持久授权无法读取".into(),
                    source_instance_id: None,
                    evidence: None,
                }),
            }
        }
        let mut seen = BTreeSet::new();
        for root in roots {
            let root = if matches!(
                root.file_name().and_then(|n| n.to_str()),
                Some("sessions" | "archived_sessions")
            ) {
                root.parent().unwrap_or(&root).to_path_buf()
            } else {
                root
            };
            let root = fs::canonicalize(&root).unwrap_or_else(|_| {
                if root.is_absolute() {
                    root.clone()
                } else {
                    env::current_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                        .join(&root)
                }
            });
            if !seen.insert(root.clone()) {
                continue;
            }
            let text = root.to_string_lossy().into_owned();
            let id = stable_id(&["codex", &text]);
            if !request.roots.is_empty() && !root.is_dir() {
                result.issues.push(Issue {
                    code: "sourceUnreadable".into(),
                    message: "指定的 Codex 来源目录不存在或无法读取".into(),
                    source_instance_id: Some(id.clone()),
                    evidence: None,
                });
            }
            result.sources.push(SourceInstance {
                id,
                agent_kind: "codex".into(),
                root: text,
            });
        }
        result
    }

    fn collect(
        &self,
        source: &SourceInstance,
        _: &ReadPlan,
        context: &RunContext,
        sink: &mut dyn FactSink,
    ) -> SourceReport {
        let descriptor = self.descriptor();
        let mut report = SourceReport {
            source: source.clone(),
            adapter_version: descriptor.adapter_version,
            source_versions: vec![],
            capabilities: descriptor.capabilities,
            status: "complete".into(),
            files_read: 0,
            bytes_read: 0,
            issues: vec![],
        };
        let root = Path::new(&source.root);
        if !root.exists() {
            report.status = "notFound".into();
            return report;
        }
        let mut files = BTreeSet::new();
        let mut visited = BTreeSet::new();
        for directory in [root.join("sessions"), root.join("archived_sessions")] {
            list_files(
                &directory,
                0,
                &mut files,
                &mut visited,
                context,
                &mut report,
            );
        }
        let mut facts = Facts::default();
        let mut attempted = 0;
        for file in files {
            if context.is_cancelled() {
                report.status = "cancelled".into();
                break;
            }
            if report.bytes_read >= context.max_bytes {
                issue(&mut report, "resourceLimit", "来源读取达到字节上限", None);
                break;
            }
            attempted += 1;
            read_file(&file, source, context, &mut facts, &mut report);
        }
        finish_facts(facts, root, &mut report, sink);
        if report.status != "cancelled" && !report.issues.is_empty() {
            report.status = if report.files_read == 0
                && (attempted > 0 || report.issues.iter().any(|i| i.code == "sourceUnreadable"))
            {
                "failed"
            } else {
                "partial"
            }
            .into();
        }
        if context.is_cancelled() {
            report.status = "cancelled".into();
        }
        report
    }
}

fn finish_facts(mut facts: Facts, root: &Path, report: &mut SourceReport, sink: &mut dyn FactSink) {
    let parents = std::mem::take(&mut facts.parents);
    let forest = ancestry::ForkForest::new(&parents);
    if forest.unresolved > 0 {
        issue(
            report,
            "forkAncestryCycle",
            "分叉关系存在循环，保留相关事实而不推断重放",
            None,
        );
    }
    facts.remove_inherited(&forest);
    facts.remove_inherited_operations(&forest, report);
    facts.reconcile_direct(report);
    for (thread, projects) in &facts.projects {
        if projects.len() > 1 {
            if let Some(value) = facts.threads.get_mut(thread) {
                value.project = None;
            }
            issue(
                report,
                "projectConflict",
                "对话记录涉及多个工作目录，未推断单一项目",
                None,
            );
        }
    }
    read_titles(root, &mut facts, report);
    for thread in facts.threads.into_values() {
        sink.push(Fact::Thread(thread));
    }
    let mut turns: Vec<_> = facts.turns.into_values().collect();
    turns.sort_by(|a, b| {
        (&a.thread_id, &a.started_at, &a.id).cmp(&(&b.thread_id, &b.started_at, &b.id))
    });
    let mut ordinal = HashMap::<String, u64>::new();
    for mut turn in turns {
        let number = ordinal.entry(turn.thread_id.clone()).or_default();
        *number += 1;
        turn.ordinal = *number;
        sink.push(Fact::Turn(turn));
    }
    for (_, candidate) in facts.measurements {
        sink.push(Fact::Measurement(candidate.measurement));
    }
    for event in facts.events.into_values() {
        sink.push(Fact::Event(event));
    }
    for operation in facts.operations.into_values() {
        sink.push(Fact::Operation(operation));
    }
}

fn issue(report: &mut SourceReport, code: &str, message: &str, evidence: Option<EvidenceRef>) {
    // Repeated failures are summarized without retaining attacker-controlled log text.
    if report.issues.len() < 1000 {
        report.issues.push(Issue {
            code: code.into(),
            message: message.into(),
            source_instance_id: Some(report.source.id.clone()),
            evidence,
        });
    } else if !report.issues.iter().any(|v| v.code == "issueLimit") {
        report.issues.push(Issue {
            code: "issueLimit".into(),
            message: "更多读取问题已省略".into(),
            source_instance_id: Some(report.source.id.clone()),
            evidence: None,
        });
    }
}

fn list_files(
    directory: &Path,
    depth: usize,
    files: &mut BTreeSet<PathBuf>,
    visited: &mut BTreeSet<PathBuf>,
    context: &RunContext,
    report: &mut SourceReport,
) {
    if context.is_cancelled() {
        return;
    }
    if depth > 64 {
        issue(report, "resourceLimit", "日志目录超过深度上限", None);
        return;
    }
    let canonical = match fs::canonicalize(directory) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            issue(report, "sourceUnreadable", "无法读取日志目录", None);
            return;
        }
    };
    if !visited.insert(canonical) {
        return;
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            issue(report, "sourceUnreadable", "无法读取日志目录", None);
            return;
        }
    };
    for entry in entries {
        if files.len() >= context.max_files {
            issue(report, "resourceLimit", "日志文件达到数量上限", None);
            break;
        }
        let Ok(entry) = entry else {
            issue(report, "sourceUnreadable", "无法读取日志目录项", None);
            continue;
        };
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            issue(report, "sourceUnreadable", "无法读取日志文件属性", None);
            continue;
        };
        // Directory symlinks are deliberately not followed outside an explicit source root.
        if kind.is_dir() {
            list_files(&path, depth + 1, files, visited, context, report);
        } else if kind.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
            files.insert(path);
        }
    }
}

mod accounting;
mod events;
mod facts;
mod reading;
mod titles;
use events::process;
use facts::{Candidate, Facts, merge_optional};
use reading::{State, file_changed, precision, read_file, read_file_from, timestamp};
use titles::read_titles;
pub(super) fn safe_text(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ('@'..='~').contains(&ch) {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch == '\u{7}' || ch == '\u{1b}' {
                        break;
                    }
                }
            }
            continue;
        }
        if ch.is_control()
            || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{200b}')
        {
            continue;
        }
        result.push(ch);
        if result.len() >= 1024 {
            break;
        }
    }
    result
}

fn reported_cost(raw: Option<&serde_json::value::RawValue>) -> Option<String> {
    let raw = raw?.get();
    let value = if raw.starts_with('"') {
        serde_json::from_str::<String>(raw).ok()?
    } else {
        raw.to_owned()
    };
    (value.len() < 128 && serde_json::from_str::<serde_json::Number>(&value).is_ok())
        .then_some(value)
}
