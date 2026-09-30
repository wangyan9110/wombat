//! Independent Codex rollout adapter. Only explicit identities merge facts.
mod identity;
pub(crate) mod incremental;
#[cfg(test)]
mod tests;
mod wire;

use super::{contract::*, stable_id};
use chrono::DateTime;
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

pub const VERSION: &str = "codex-rollout-1";
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
        let roots = if request.roots.is_empty() {
            vec![
                env::var_os("CODEX_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| {
                        env::var_os("HOME")
                            .map(PathBuf::from)
                            .unwrap_or_else(|| PathBuf::from("."))
                            .join(".codex")
                    }),
            ]
        } else {
            request.roots.clone()
        };
        let mut result = DiscoveryReport::default();
        let identities = identity::read_registry();
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
            let id = identities
                .as_ref()
                .and_then(|registry| registry.source(&root))
                .unwrap_or_else(|| stable_id(&["codex", &text]));
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
        let mut facts = Facts {
            identities: identity::read_registry(),
            ..Facts::default()
        };
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
    facts.remove_inherited();
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
    facts.apply_identities();
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

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Facts {
    threads: BTreeMap<String, Thread>,
    turns: BTreeMap<String, Turn>,
    measurements: BTreeMap<String, Candidate>,
    operations: BTreeMap<String, Arc<Operation>>,
    #[serde(skip)]
    dirty_operations: BTreeSet<String>,
    #[serde(skip)]
    dirty_measurements: BTreeSet<String>,
    #[serde(skip)]
    dirty_aliases: BTreeSet<String>,
    aliases: HashMap<String, String>,
    parents: HashMap<String, String>,
    #[serde(skip)]
    identities: Option<identity::Registry>,
    migrated: BTreeMap<String, String>,
    measurement_conflicts: BTreeSet<String>,
    projects: BTreeMap<String, BTreeSet<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Candidate {
    measurement: Arc<Measurement>,
    direct: bool,
    cumulative: Option<u64>,
    interval_start: Option<u64>,
    fingerprint: String,
}

impl Facts {
    fn fork_derived(&self) -> Self {
        Self {
            threads: self.threads.clone(),
            turns: self.turns.clone(),
            measurements: self.measurements.clone(),
            operations: self.operations.clone(),
            parents: self.parents.clone(),
            migrated: self.migrated.clone(),
            measurement_conflicts: self.measurement_conflicts.clone(),
            projects: self.projects.clone(),
            ..Self::default()
        }
    }
    fn apply_identities(&mut self) {
        if self.migrated.is_empty() {
            return;
        }
        let remap = |id: &mut String| {
            if let Some(old) = self.migrated.get(id) {
                *id = old.clone();
            }
        };
        for thread in self.threads.values_mut() {
            remap(&mut thread.id);
        }
        let mut turn_ids = HashMap::new();
        for turn in self.turns.values_mut() {
            let old = turn.id.clone();
            remap(&mut turn.thread_id);
            turn.id = stable_id(&[&turn.thread_id, "turn", &turn.upstream_id]);
            turn_ids.insert(old, turn.id.clone());
        }
        for candidate in self.measurements.values_mut() {
            let m = Arc::make_mut(&mut candidate.measurement);
            if let Some(thread) = &mut m.thread_id {
                remap(thread);
            }
            if let Some(turn) = &mut m.turn_id
                && let Some(id) = turn_ids.get(turn)
            {
                *turn = id.clone();
            }
        }
        for operation in self.operations.values_mut() {
            if !self.migrated.contains_key(&operation.thread_id) {
                continue;
            }
            let operation = Arc::make_mut(operation);
            remap(&mut operation.thread_id);
            if let Some(turn) = &mut operation.turn_id
                && let Some(id) = turn_ids.get(turn)
            {
                *turn = id.clone();
            }
        }
    }
    fn thread(
        &mut self,
        source: &SourceInstance,
        upstream: &str,
        timestamp: Option<&str>,
        cwd: Option<&str>,
    ) -> String {
        let id = stable_id(&["codex", &source.id, "thread", upstream]);
        if let Some(cwd) = cwd {
            self.projects
                .entry(id.clone())
                .or_default()
                .insert(cwd.into());
        }
        let thread = self.threads.entry(id.clone()).or_insert_with(|| Thread {
            id: id.clone(),
            agent_kind: "codex".into(),
            source_instance_id: source.id.clone(),
            upstream_id: upstream.into(),
            title: None,
            project: cwd.map(safe_text),
            started_at: timestamp.map(str::to_owned),
            last_activity_at: timestamp.map(str::to_owned),
        });
        if let Some(time) = timestamp {
            if thread.started_at.as_deref().is_none_or(|old| old > time) {
                thread.started_at = Some(time.into());
            }
            if thread
                .last_activity_at
                .as_deref()
                .is_none_or(|old| old < time)
            {
                thread.last_activity_at = Some(time.into());
            }
        }
        if thread.project.is_none() {
            thread.project = cwd.map(safe_text);
        }
        id
    }
    fn turn(
        &mut self,
        thread: &str,
        upstream: &str,
        timestamp: Option<&str>,
        status: Option<&str>,
    ) -> String {
        let id = stable_id(&[thread, "turn", upstream]);
        let turn = self.turns.entry(id.clone()).or_insert_with(|| Turn {
            id: id.clone(),
            thread_id: thread.into(),
            upstream_id: upstream.into(),
            ordinal: 0,
            started_at: timestamp.map(str::to_owned),
            ended_at: None,
            status: "unknown".into(),
        });
        if let Some(time) = timestamp
            && turn.started_at.as_deref().is_none_or(|old| old > time)
        {
            turn.started_at = Some(time.into());
        }
        if let Some(status) = status {
            if status != "running" || turn.status == "unknown" {
                turn.status = status.into();
            }
            if matches!(status, "completed" | "interrupted" | "failed") {
                turn.ended_at = timestamp.map(str::to_owned);
            }
        }
        id
    }
    fn measurement(&mut self, candidate: Candidate, report: &mut SourceReport) {
        self.dirty_measurements
            .insert(candidate.measurement.id.clone());
        if let Some(existing) = self.measurements.get_mut(&candidate.measurement.id) {
            existing.direct |= candidate.direct;
            existing.cumulative = existing.cumulative.or(candidate.cumulative);
            existing.interval_start = existing.interval_start.or(candidate.interval_start);
            let incoming = Arc::unwrap_or_clone(candidate.measurement);
            let old = Arc::make_mut(&mut existing.measurement);
            let prefix = old.id.clone();
            let conflicts = &mut self.measurement_conflicts;
            let mut token_conflict = false;
            for (field, current, new) in [
                ("input", &mut old.tokens.input, &incoming.tokens.input),
                (
                    "cacheRead",
                    &mut old.tokens.cache_read,
                    &incoming.tokens.cache_read,
                ),
                (
                    "cacheCreate",
                    &mut old.tokens.cache_create,
                    &incoming.tokens.cache_create,
                ),
                ("output", &mut old.tokens.output, &incoming.tokens.output),
                (
                    "reasoning",
                    &mut old.tokens.reasoning,
                    &incoming.tokens.reasoning,
                ),
                ("total", &mut old.tokens.total, &incoming.tokens.total),
                (
                    "rawInput",
                    &mut old.tokens.raw_input,
                    &incoming.tokens.raw_input,
                ),
            ] {
                token_conflict |=
                    merge_optional(current, new, conflicts, &format!("{prefix}:{field}"));
            }
            if token_conflict {
                issue(
                    report,
                    "measurementConflict",
                    "同一用量身份出现不同计数",
                    incoming.evidence.first().cloned(),
                );
            }
            if merge_optional(
                &mut old.turn_id,
                &incoming.turn_id,
                conflicts,
                &format!("{prefix}:turn"),
            ) {
                issue(
                    report,
                    "ownershipConflict",
                    "同一用量的轮次归属冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            let mut model_conflict = merge_optional(
                &mut old.model.raw,
                &incoming.model.raw,
                conflicts,
                &format!("{prefix}:model"),
            );
            model_conflict |= merge_optional(
                &mut old.model.provider,
                &incoming.model.provider,
                conflicts,
                &format!("{prefix}:provider"),
            );
            model_conflict |= merge_optional(
                &mut old.model.api_provider,
                &incoming.model.api_provider,
                conflicts,
                &format!("{prefix}:apiProvider"),
            );
            if model_conflict {
                issue(
                    report,
                    "modelConflict",
                    "同一用量的模型冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            if merge_optional(
                &mut old.reasoning_effort,
                &incoming.reasoning_effort,
                conflicts,
                &format!("{prefix}:effort"),
            ) {
                issue(
                    report,
                    "contextConflict",
                    "同一用量的推理强度冲突",
                    incoming.evidence.first().cloned(),
                );
            }
            if candidate.direct {
                old.request_scoped = true;
                old.grain = "response".into();
            }
            if incoming
                .timestamp
                .as_ref()
                .is_some_and(|new| old.timestamp.as_ref().is_none_or(|current| new < current))
            {
                old.timestamp = incoming.timestamp;
                old.time_precision = incoming.time_precision;
            }
            for evidence in incoming.evidence {
                if !old.evidence.contains(&evidence) {
                    old.evidence.push(evidence);
                }
            }
        } else {
            self.measurements
                .insert(candidate.measurement.id.clone(), candidate);
        }
    }
    fn operation(&mut self, mut operation: Operation) {
        let aliases: Vec<_> = [operation.call_id.as_deref(), operation.item_id.as_deref()]
            .into_iter()
            .flatten()
            .map(|id| stable_id(&[&operation.thread_id, "operation", id]))
            .collect();
        if let Some(id) = aliases
            .iter()
            .find_map(|key| self.aliases.get(key))
            .cloned()
        {
            operation.id = id;
        }
        for alias in aliases {
            self.dirty_aliases.insert(alias.clone());
            self.aliases.insert(alias, operation.id.clone());
        }
        self.dirty_operations.insert(operation.id.clone());
        if let Some(old) = self.operations.get_mut(&operation.id) {
            let old = Arc::make_mut(old);
            if operation.status != "running"
                && operation.status != "unknown"
                && old.status != "failed"
                && old.status != "interrupted"
            {
                old.status = operation.status;
            }
            if old.kind == "tool" && operation.kind != "tool" {
                old.kind = operation.kind;
            }
            if old.name == "tool" {
                old.name = operation.name;
            }
            if old.turn_id.is_none() {
                old.turn_id = operation.turn_id;
            }
            if old.item_id.is_none() {
                old.item_id = operation.item_id;
            }
            if old.call_id.is_none() {
                old.call_id = operation.call_id;
            }
            if old.response_id.is_none() {
                old.response_id = operation.response_id;
            }
            if old.path.is_none() {
                old.path = operation.path;
            }
            if old.server.is_none() {
                old.server = operation.server;
            }
            if old.tool.is_none() {
                old.tool = operation.tool;
            }
            old.exit_code = operation.exit_code.or(old.exit_code);
            old.duration_ms = operation.duration_ms.or(old.duration_ms);
            for evidence in operation.evidence {
                if !old.evidence.contains(&evidence) {
                    old.evidence.push(evidence);
                }
            }
        } else {
            self.operations
                .insert(operation.id.clone(), Arc::new(operation));
        }
    }
    fn remove_inherited(&mut self) {
        // A fork relationship plus byte-identical source event is concrete replay evidence.
        let identities: BTreeSet<_> = self
            .measurements
            .values()
            .filter_map(|c| {
                c.measurement
                    .thread_id
                    .as_ref()
                    .map(|t| (t.clone(), c.fingerprint.clone()))
            })
            .collect();
        let mut remove = Vec::new();
        for (id, candidate) in &self.measurements {
            if candidate.direct {
                continue;
            }
            let Some(mut thread) = candidate.measurement.thread_id.as_ref() else {
                continue;
            };
            let mut seen = BTreeSet::new();
            while let Some(parent) = self.parents.get(thread) {
                if !seen.insert(parent) {
                    break;
                }
                if identities.contains(&(parent.clone(), candidate.fingerprint.clone())) {
                    remove.push(id.clone());
                    break;
                }
                thread = parent;
            }
        }
        for id in remove {
            self.measurements.remove(&id);
        }
    }
    fn reconcile_direct(&mut self, report: &mut SourceReport) {
        // Build coverage once per owner. Scanning every direct response for every
        // legacy counter is quadratic across unrelated historical conversations.
        let mut direct = BTreeMap::<String, Vec<(u64, u64)>>::new();
        let mut unbounded = BTreeMap::<Option<String>, BTreeSet<Option<String>>>::new();
        for candidate in self.measurements.values().filter(|v| v.direct) {
            if let (Some(thread), Some(start), Some(end)) = (
                &candidate.measurement.thread_id,
                candidate.interval_start,
                candidate.cumulative,
            ) {
                direct.entry(thread.clone()).or_default().push((start, end));
            }
            if candidate.interval_start.is_none() || candidate.cumulative.is_none() {
                unbounded
                    .entry(candidate.measurement.thread_id.clone())
                    .or_default()
                    .insert(candidate.measurement.turn_id.clone());
            }
        }
        for ranges in direct.values_mut() {
            ranges.sort_unstable();
            let mut merged: Vec<(u64, u64)> = Vec::new();
            for &(start, end) in ranges.iter() {
                if let Some(last) = merged.last_mut()
                    && start <= last.1
                {
                    last.1 = last.1.max(end);
                } else {
                    merged.push((start, end));
                }
            }
            *ranges = merged;
        }
        let mut remove = Vec::new();
        for (id, candidate) in &self.measurements {
            if candidate.direct {
                continue;
            }
            if unbounded
                .get(&candidate.measurement.thread_id)
                .is_some_and(|turns| {
                    candidate.measurement.turn_id.is_none()
                        || turns.contains(&None)
                        || turns.contains(&candidate.measurement.turn_id)
                })
            {
                issue(
                    report,
                    "usageCoverageUnknown",
                    "同轮存在逐响应用量，未叠加缺少覆盖依据的旧累计记录",
                    candidate.measurement.evidence.first().cloned(),
                );
                remove.push(id.clone());
                continue;
            }
            let (Some(thread), Some(start), Some(end)) = (
                &candidate.measurement.thread_id,
                candidate.interval_start,
                candidate.cumulative,
            ) else {
                continue;
            };
            let ranges = direct.get(thread).map(Vec::as_slice).unwrap_or_default();
            let next = ranges.get(ranges.partition_point(|(_, to)| *to <= start));
            let overlaps = next.is_some_and(|(from, _)| *from < end);
            if next.is_some_and(|(from, to)| *from <= start && *to >= end) && end > start {
                remove.push(id.clone());
            } else if overlaps {
                issue(
                    report,
                    "usageOverlap",
                    "逐响应记录与累计区间部分重叠；该累计记录未重复计入",
                    candidate.measurement.evidence.first().cloned(),
                );
                remove.push(id.clone());
            }
        }
        for id in remove {
            self.measurements.remove(&id);
        }
    }
}

fn merge_optional<T: Clone + Eq>(
    current: &mut Option<T>,
    new: &Option<T>,
    conflicts: &mut BTreeSet<String>,
    key: &str,
) -> bool {
    if conflicts.contains(key) {
        *current = None;
        return false;
    }
    if current
        .as_ref()
        .zip(new.as_ref())
        .is_some_and(|(a, b)| a != b)
    {
        *current = None;
        conflicts.insert(key.into());
        return true;
    }
    if current.is_none() {
        *current = new.clone();
    }
    false
}

#[derive(Default, Serialize, Deserialize)]
struct State {
    thread: Option<String>,
    turn: Option<String>,
    model: ModelRef,
    effort: Option<String>,
    thread_model: ModelRef,
    thread_effort: Option<String>,
    previous: Option<TokenUsage>,
    ordinal: u64,
    epoch: u64,
    uncertain_counter: bool,
}
impl State {
    fn break_context(&mut self) {
        self.turn = None;
        self.model = ModelRef::default();
        self.effort = None;
        self.thread_model = ModelRef::default();
        self.thread_effort = None;
        self.previous = None;
        self.epoch += 1;
    }
    fn corrupt_boundary(&mut self) {
        self.break_context();
        self.uncertain_counter = true;
    }
}

fn timestamp(text: Option<&str>) -> Option<String> {
    text.and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| {
            t.to_utc()
                .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
        })
}
fn precision(text: Option<&str>) -> String {
    let fraction = text
        .and_then(|text| text.split_once('.'))
        .map(|(_, fraction)| fraction.chars().take_while(char::is_ascii_digit).count())
        .unwrap_or(0);
    if fraction > 6 {
        "nanosecond"
    } else if fraction > 3 {
        "microsecond"
    } else if fraction > 0 {
        "millisecond"
    } else if text.is_some_and(|t| t.len() >= 19) {
        "second"
    } else {
        "unknown"
    }
    .into()
}

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

fn read_file(
    path: &Path,
    source: &SourceInstance,
    context: &RunContext,
    facts: &mut Facts,
    report: &mut SourceReport,
) {
    read_file_from(path, source, context, facts, report, None);
}

fn read_file_from(
    path: &Path,
    source: &SourceInstance,
    context: &RunContext,
    facts: &mut Facts,
    report: &mut SourceReport,
    mut checkpoint: Option<&mut incremental::Checkpoint>,
) {
    let evidence_path: Arc<str> = path.to_string_lossy().as_ref().into();
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => {
            issue(
                report,
                "sourceUnreadable",
                "无法读取日志文件",
                Some(EvidenceRef {
                    file: Arc::clone(&evidence_path),
                    line: 0,
                }),
            );
            return;
        }
    };
    let before = file.metadata().ok();
    let length = before.as_ref().map_or(0, |m| m.len());
    let legacy = facts
        .identities
        .as_ref()
        .and_then(|registry| registry.file(path));
    let mut prefix_hash = Sha256::new();
    if length > context.max_bytes.saturating_sub(report.bytes_read) {
        issue(report, "resourceLimit", "日志文件超出剩余读取范围", None);
        return;
    }
    // Freeze this read to the observed prefix; later appends belong to the next refresh.
    let offset = checkpoint.as_ref().map_or(0, |c| c.offset);
    if file.seek(SeekFrom::Start(offset)).is_err() {
        issue(report, "sourceUnreadable", "无法定位日志增量", None);
        return;
    }
    let mut reader = BufReader::new(file.take(length.saturating_sub(offset)));
    let mut buffer = Vec::new();
    let mut state = checkpoint
        .as_mut()
        .map_or_else(State::default, |c| std::mem::take(&mut c.state));
    let mut line_number = checkpoint.as_ref().map_or(0, |c| c.line);
    let mut consumed = offset;
    let mut pending_tail = false;
    let mut valid_records = 0;
    loop {
        if context.is_cancelled() {
            report.status = "cancelled".into();
            break;
        }
        let row = match crate::log_io::next_line(&mut reader, &mut buffer) {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(_) => {
                issue(report, "sourceUnreadable", "日志读取中断", None);
                break;
            }
        };
        // A live cursor only commits complete newline-delimited records. No state is
        // changed by a partial tail, even when its current prefix is valid JSON.
        if checkpoint.is_some() && !row.bytes().ends_with(b"\n") {
            report.bytes_read += row.bytes().len() as u64;
            pending_tail = true;
            issue(
                report,
                "incompleteTail",
                "日志尾行尚未写完",
                Some(EvidenceRef {
                    file: Arc::clone(&evidence_path),
                    line: line_number + 1,
                }),
            );
            break;
        }
        line_number += 1;
        if let Some(old) = &legacy {
            let count = old
                .size
                .saturating_sub(consumed)
                .min(row.bytes().len() as u64) as usize;
            prefix_hash.update(&row.bytes()[..count]);
        }
        consumed += row.bytes().len() as u64;
        report.bytes_read += row.bytes().len() as u64;
        let evidence = EvidenceRef {
            file: Arc::clone(&evidence_path),
            line: line_number,
        };
        if row.bytes().iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let record: Envelope = match serde_json::from_slice(row.bytes()) {
            Ok(record) => record,
            Err(_) => {
                let tail = !row.bytes().ends_with(b"\n");
                issue(
                    report,
                    if tail {
                        "incompleteTail"
                    } else {
                        "invalidRecord"
                    },
                    if tail {
                        "日志尾行尚未写完"
                    } else {
                        "日志记录格式无效"
                    },
                    Some(evidence),
                );
                state.corrupt_boundary();
                continue;
            }
        };
        let payload: Payload = match serde_json::from_str(record.payload.get()) {
            Ok(payload) => payload,
            Err(_) => {
                issue(report, "invalidRecord", "日志字段格式无效", Some(evidence));
                state.corrupt_boundary();
                continue;
            }
        };
        valid_records += 1;
        let time = timestamp(record.timestamp);
        if record.timestamp.is_some() && time.is_none() {
            issue(
                report,
                "invalidTimestamp",
                "日志时间无效，保留未归日计量",
                Some(evidence.clone()),
            );
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(row.bytes().strip_suffix(b"\n").unwrap_or(row.bytes()))
        );
        process(
            record.kind,
            payload,
            time,
            record.timestamp,
            evidence,
            fingerprint,
            &mut state,
            facts,
            source,
            report,
        );
    }
    if valid_records > 0 || length == 0 {
        report.files_read += 1;
    }
    if let Some(old) = legacy
        && offset == 0
        && old.size <= consumed
        && format!("{:x}", prefix_hash.finalize()) == old.content_hash
        && let Some(thread) = state.thread.as_ref().and_then(|id| facts.threads.get(id))
    {
        let id = old.thread_id(&thread.upstream_id);
        facts
            .migrated
            .entry(thread.id.clone())
            .and_modify(|prior| {
                if id < *prior {
                    *prior = id.clone();
                }
            })
            .or_insert(id);
    }
    let after = fs::metadata(path).ok();
    if (consumed < length && !pending_tail)
        || after.as_ref().is_none_or(|m| m.len() < length)
        || before
            .as_ref()
            .zip(after.as_ref())
            .is_some_and(|(a, b)| file_changed(a, b))
    {
        issue(report, "sourceChanged", "日志在读取期间被替换或截断", None);
    }
    if let Some(checkpoint) = checkpoint {
        checkpoint.offset = consumed;
        checkpoint.line = line_number;
        checkpoint.state = state;
    }
}

#[cfg(unix)]
fn file_changed(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() != b.dev()
        || a.ino() != b.ino()
        || (a.len() == b.len() && a.modified().ok() != b.modified().ok())
}
#[cfg(not(unix))]
fn file_changed(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.len() == b.len() && a.modified().ok() != b.modified().ok()
}

#[allow(clippy::too_many_arguments)]
fn process(
    kind: &str,
    p: Payload<'_>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &mut State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    if kind == "session_meta" {
        if let Some(version) = p.cli_version.as_deref() {
            let version = safe_text(version);
            if !report.source_versions.contains(&version) {
                report.source_versions.push(version);
            }
        }
        if let Some(upstream) = p.id.as_deref().or(p.session_id.as_deref()) {
            state.break_context();
            state.uncertain_counter = false;
            let thread = facts.thread(source, upstream, time.as_deref(), p.cwd.as_deref());
            if let Some(parent) = p.forked_from_id.as_deref() {
                let parent = stable_id(&["codex", &source.id, "thread", parent]);
                facts.parents.insert(thread.clone(), parent);
            }
            state.thread = Some(thread);
        }
        return;
    }
    let event = if kind == "event_msg" {
        p.kind.as_deref().unwrap_or("")
    } else {
        kind
    };
    let owner = p
        .thread_id
        .as_deref()
        .map(|upstream| facts.thread(source, upstream, time.as_deref(), None))
        .or_else(|| state.thread.clone());
    if let Some(thread) = &owner
        && let Some(t) = facts.threads.get_mut(thread)
        && time
            .as_ref()
            .is_some_and(|new| t.last_activity_at.as_ref().is_none_or(|old| new > old))
    {
        t.last_activity_at = time.clone();
    }
    let explicit_turn = owner
        .as_ref()
        .zip(p.turn_id.as_deref())
        .map(|(thread, turn)| facts.turn(thread, turn, time.as_deref(), None));
    if matches!(event, "turn_context" | "thread_settings_applied") {
        if let Some(upstream) = owner
            .as_ref()
            .and_then(|id| facts.threads.get(id))
            .map(|t| t.upstream_id.clone())
        {
            facts.thread(source, &upstream, time.as_deref(), p.cwd.as_deref());
        }
        if owner != state.thread {
            state.break_context();
            state.thread = owner.clone();
        }
        if let Some(turn) = explicit_turn {
            state.turn = Some(turn);
        }
        let (model, effort, conflict) = context_fields(&p);
        state.model = model;
        state.effort = effort;
        if event == "thread_settings_applied" {
            state.thread_model = state.model.clone();
            state.thread_effort = state.effort.clone();
        }
        if conflict {
            issue(
                report,
                "contextConflict",
                "历史模型或推理强度设置冲突",
                Some(evidence),
            );
        }
        return;
    }
    if matches!(
        event,
        "task_started" | "task_complete" | "turn_aborted" | "turn_failed"
    ) {
        let status = match event {
            "task_started" => "running",
            "task_complete" => "completed",
            "turn_failed" => "failed",
            _ => "interrupted",
        };
        if let (Some(thread), Some(upstream)) = (&owner, p.turn_id.as_deref()) {
            let new_turn = facts.turn(thread, upstream, time.as_deref(), Some(status));
            if event == "task_started" && state.turn.as_deref() != Some(&new_turn) {
                state.model = state.thread_model.clone();
                state.effort = state.thread_effort.clone();
            }
            state.turn = Some(new_turn);
        }
        if event != "task_started" {
            state.turn = None;
            state.model = state.thread_model.clone();
            state.effort = state.thread_effort.clone();
        }
        return;
    }
    let same_owner = owner == state.thread;
    let turn = explicit_turn.or_else(|| same_owner.then(|| state.turn.clone()).flatten());
    if event == "token_usage_record" {
        direct_measurement(
            &p,
            owner,
            turn,
            time,
            raw_time,
            evidence,
            fingerprint,
            state,
            facts,
            source,
            report,
        );
    } else if event == "token_count" {
        legacy_measurement(
            &p,
            owner,
            turn,
            time,
            raw_time,
            evidence,
            fingerprint,
            state,
            facts,
            source,
            report,
        );
    } else if event == "compacted" {
        if let Some(raw) = p.latest_token_usage_record
            && let Ok(latest) = serde_json::from_str::<Payload>(raw.get())
        {
            let latest_owner = latest
                .thread_id
                .as_deref()
                .map(|id| facts.thread(source, id, time.as_deref(), None))
                .or(owner.clone());
            let latest_turn = latest_owner
                .as_ref()
                .zip(latest.turn_id.as_deref())
                .map(|(t, id)| facts.turn(t, id, time.as_deref(), None));
            direct_measurement(
                &latest,
                latest_owner,
                latest_turn,
                time.clone(),
                raw_time,
                evidence.clone(),
                fingerprint.clone(),
                state,
                facts,
                source,
                report,
            );
        }
        if let Some(thread) = owner {
            let identity = p.compaction_response_id.as_deref().unwrap_or(&fingerprint);
            let mut op = empty_operation(
                &thread,
                turn,
                time,
                raw_time,
                &evidence,
                "compaction",
                "上下文压缩",
                identity,
            );
            op.response_id = p.compaction_response_id;
            op.status = "completed".into();
            facts.operation(op);
        }
    } else if (kind == "response_item" || matches!(event, "item_completed" | "item_started"))
        && let Some(thread) = owner
    {
        operation(
            &p,
            event,
            &thread,
            turn,
            time,
            raw_time,
            evidence,
            &fingerprint,
            facts,
            report,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn direct_measurement(
    p: &Payload<'_>,
    owner: Option<String>,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    let Some(raw) = p.usage else {
        issue(report, "missingUsage", "逐响应记录缺少用量", Some(evidence));
        return;
    };
    let Some(tokens) = parse_tokens(raw, report, &evidence) else {
        return;
    };
    let response = p.response_id.as_deref();
    let id = if let Some(response) = response {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "response",
            response,
        ])
    } else {
        issue(
            report,
            "missingResponseIdentity",
            "用量记录缺少响应身份",
            Some(evidence.clone()),
        );
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "record",
            &evidence.file,
            &evidence.line.to_string(),
        ])
    };
    let cumulative = p
        .thread_token_usage
        .and_then(|raw| serde_json::from_str::<Counts>(raw.get()).ok())
        .and_then(|c| c.total_tokens);
    let interval_start = cumulative
        .zip(tokens.total)
        .and_then(|(a, b)| a.checked_sub(b));
    let (model, effort) = measurement_context(
        p,
        state,
        owner.as_ref() == state.thread.as_ref(),
        turn.as_deref(),
    );
    facts.measurement(
        Candidate {
            measurement: Measurement {
                id,
                agent_kind: "codex".into(),
                source_instance_id: source.id.clone(),
                thread_id: owner,
                turn_id: turn,
                response_id: response.map(str::to_owned),
                timestamp: time,
                interval_end: None,
                grain: "response".into(),
                time_precision: precision(raw_time),
                model,
                reasoning_effort: effort,
                tokens,
                request_scoped: true,
                reported_cost: reported_cost(p.cost),
                service_tier: p.service_tier.as_deref().map(safe_text),
                sequence: evidence.line,
                evidence: vec![evidence],
            }
            .into(),
            direct: true,
            cumulative,
            interval_start,
            fingerprint,
        },
        report,
    );
}

#[allow(clippy::too_many_arguments)]
fn legacy_measurement(
    p: &Payload<'_>,
    owner: Option<String>,
    turn: Option<String>,
    time: Option<String>,
    raw_time: Option<&str>,
    evidence: EvidenceRef,
    fingerprint: String,
    state: &mut State,
    facts: &mut Facts,
    source: &SourceInstance,
    report: &mut SourceReport,
) {
    let Some(info) = p
        .info
        .and_then(|raw| serde_json::from_str::<UsageInfo>(raw.get()).ok())
    else {
        return;
    };
    let total = info
        .total_token_usage
        .and_then(|raw| parse_legacy_tokens(raw, report, &evidence));
    let last = info
        .last_token_usage
        .and_then(|raw| parse_legacy_tokens(raw, report, &evidence));
    if total.is_none() && last.is_none() {
        return;
    }
    let previous_total = state.previous.as_ref().and_then(|v| v.total).unwrap_or(0);
    if total
        .as_ref()
        .is_some_and(|new| state.previous.as_ref() == Some(new))
    {
        return;
    }
    let regression = state
        .previous
        .as_ref()
        .zip(total.as_ref())
        .is_some_and(|(old, new)| counts_regress(old, new));
    if regression {
        state.epoch += 1;
        issue(
            report,
            "counterReset",
            "累计用量回退，已开启新的计数区间",
            Some(evidence.clone()),
        );
    }
    let (tokens, request_scoped) = if state.uncertain_counter {
        issue(
            report,
            "counterGap",
            "格式断点后的累计用量不重复回填，只保留明确单次记录",
            Some(evidence.clone()),
        );
        state.uncertain_counter = false;
        if let Some(last) = last {
            (last, true)
        } else {
            (TokenUsage::default(), false)
        }
    } else if regression {
        if let Some(last) = last {
            (last, true)
        } else {
            issue(
                report,
                "ambiguousReset",
                "累计回退缺少单次用量，保留未知计量",
                Some(evidence.clone()),
            );
            (TokenUsage::default(), false)
        }
    } else if let Some(total) = &total {
        let delta = subtract(total, state.previous.as_ref());
        let scoped = last.as_ref().is_some_and(|last| last == &delta);
        (delta, scoped)
    } else if let Some(last) = last {
        (last, true)
    } else {
        return;
    };
    let cumulative = total.as_ref().and_then(|v| v.total);
    let interval_start = if regression {
        cumulative
            .zip(tokens.total)
            .and_then(|(a, b)| a.checked_sub(b))
    } else {
        Some(previous_total)
    };
    state.previous = total;
    state.ordinal += 1;
    let id = if let Some(response) = p.response_id.as_deref() {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "response",
            response,
        ])
    } else {
        stable_id(&[
            "codex",
            &source.id,
            owner.as_deref().unwrap_or("unknown"),
            "legacy",
            &fingerprint,
            &state.epoch.to_string(),
            &state.ordinal.to_string(),
        ])
    };
    let (model, effort) = measurement_context(
        p,
        state,
        owner.as_ref() == state.thread.as_ref(),
        turn.as_deref(),
    );
    facts.measurement(
        Candidate {
            measurement: Measurement {
                id,
                agent_kind: "codex".into(),
                source_instance_id: source.id.clone(),
                thread_id: owner,
                turn_id: turn,
                response_id: p.response_id.clone(),
                timestamp: time,
                interval_end: None,
                grain: if request_scoped {
                    "response"
                } else {
                    "interval"
                }
                .into(),
                time_precision: precision(raw_time),
                model,
                reasoning_effort: effort,
                tokens,
                request_scoped,
                reported_cost: reported_cost(p.cost),
                service_tier: p.service_tier.as_deref().map(safe_text),
                sequence: evidence.line,
                evidence: vec![evidence],
            }
            .into(),
            direct: false,
            cumulative,
            interval_start,
            fingerprint,
        },
        report,
    );
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

fn read_titles(root: &Path, facts: &mut Facts, report: &mut SourceReport) {
    #[derive(Deserialize)]
    struct Title {
        id: String,
        thread_name: String,
        updated_at: String,
    }
    let path = root.join("session_index.jsonl");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            issue(report, "titleUnreadable", "无法读取对话标题索引", None);
            return;
        }
    };
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    let mut seen = HashMap::<String, String>::new();
    let mut bytes = 0;
    loop {
        let row = match crate::log_io::next_line(&mut reader, &mut buffer) {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(_) => {
                issue(report, "titleUnreadable", "对话标题索引读取中断", None);
                break;
            }
        };
        bytes += row.bytes().len();
        if bytes > 8 * 1024 * 1024 {
            issue(report, "resourceLimit", "对话标题索引超过 8 MiB", None);
            break;
        }
        let Ok(title) = serde_json::from_slice::<Title>(row.bytes()) else {
            issue(report, "invalidTitle", "对话标题索引有无效记录", None);
            continue;
        };
        let Some(updated) = timestamp(Some(&title.updated_at)) else {
            continue;
        };
        if seen.get(&title.id).is_some_and(|old| old > &updated) {
            continue;
        }
        seen.insert(title.id.clone(), updated);
        let id = stable_id(&["codex", &report.source.id, "thread", &title.id]);
        if let Some(thread) = facts.threads.get_mut(&id) {
            thread.title = Some(safe_text(&title.thread_name).chars().take(160).collect());
        }
    }
}
