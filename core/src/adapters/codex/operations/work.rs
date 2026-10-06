//! Codex 89c8bcf37d64be69e4c8286f4541c1a84ed312a4:
//! protocol/items.rs FileChangeItem and protocol/protocol.rs PatchApplyEnd/FileChange.
//! rollout/policy.rs persists completed items in Paginated and patch ends in Legacy.
//! Neither proposed paths nor terminal maps establish a repository baseline or net diff.
use super::*;
use serde::de::{MapAccess, Visitor};
use serde_json::value::RawValue;
mod command;
mod matching;
pub(super) use command::observe as command;

#[derive(Default)]
struct FileMap {
    changes: BTreeMap<String, FilePathChange>,
    gaps: Vec<WorkGap>,
    unavailable: bool,
    bytes: usize,
}
impl FileMap {
    fn gap(&mut self, gap: WorkGap) {
        if !self.gaps.contains(&gap) {
            self.gaps.push(gap);
        }
    }
    fn invalidate(&mut self, gap: WorkGap) {
        self.gap(gap);
        self.unavailable = true;
        self.changes.clear();
    }
}
struct FileMapVisitor;
impl<'de> Visitor<'de> for FileMapVisitor {
    type Value = FileMap;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a native file change map")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<FileMap, A::Error> {
        #[derive(Deserialize)]
        struct Change<'a> {
            #[serde(rename = "type")]
            kind: Option<String>,
            #[serde(borrow)]
            move_path: Option<&'a RawValue>,
        }
        let mut out = FileMap::default();
        while let Some(path) = map.next_key::<String>()? {
            // Borrow the validated JSON value; content/diff fields are never decoded or copied.
            let raw: &RawValue = map.next_value()?;
            if out.unavailable {
                continue;
            }
            if !valid_work_path(&path) {
                out.invalidate(WorkGap::InvalidField);
                continue;
            }
            if out.changes.contains_key(&path) {
                out.invalidate(WorkGap::ConflictingObservation);
                continue;
            }
            let Ok(change) = serde_json::from_str::<Change>(raw.get()) else {
                out.invalidate(WorkGap::InvalidField);
                continue;
            };
            let kind = match change.kind.as_deref() {
                Some("add") => ChangeKind::Add,
                Some("delete") => ChangeKind::Delete,
                Some("update") => ChangeKind::Update,
                _ => {
                    out.gap(WorkGap::UnknownVariant);
                    ChangeKind::Unknown
                }
            };
            let move_path = if kind == ChangeKind::Update {
                match change
                    .move_path
                    .map(|r| serde_json::from_str::<String>(r.get()))
                    .transpose()
                {
                    Ok(path) => path,
                    Err(_) => {
                        out.invalidate(WorkGap::InvalidField);
                        continue;
                    }
                }
            } else {
                None
            };
            if move_path.as_deref().is_some_and(|p| !valid_work_path(p)) {
                out.invalidate(WorkGap::InvalidField);
                continue;
            }
            out.bytes = out.bytes.saturating_add(path.len());
            out.bytes = out
                .bytes
                .saturating_add(move_path.as_ref().map_or(0, String::len));
            if out.changes.len() >= WORK_PATH_LIMIT || out.bytes > WORK_PATH_BYTES {
                // Consume the remaining source map without retaining a misleading prefix.
                out.invalidate(WorkGap::ResourceLimit);
                continue;
            }
            out.changes.insert(
                path.clone(),
                FilePathChange {
                    path,
                    change: kind,
                    move_path,
                },
            );
        }
        Ok(out)
    }
}
impl<'de> Deserialize<'de> for FileMap {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_map(FileMapVisitor)
    }
}

pub(super) fn file_changes(
    item: &Payload<'_>,
    terminal: bool,
    report: &mut SourceReport,
    evidence: &EvidenceRef,
) -> WorkObservation {
    let (changes, gaps) = match item.changes {
        None => (None, vec![WorkGap::MissingChanges]),
        Some(raw) => match serde_json::from_str::<FileMap>(raw.get()) {
            Ok(map) => (
                (!map.unavailable).then(|| map.changes.into_values().collect()),
                map.gaps,
            ),
            Err(_) => (None, vec![WorkGap::InvalidField]),
        },
    };
    if !gaps.is_empty() {
        issue(
            report,
            "workObservationPartial",
            "文件变更观察含缺口，不能建立完整变更范围",
            Some(evidence.clone()),
        );
    }
    WorkObservation {
        format_version: WORK_OBSERVATION_VERSION,
        stage: if terminal {
            WorkStage::Terminal
        } else {
            WorkStage::Proposed
        },
        data: WorkData::FileChange { changes },
        gaps,
    }
}

/// One native identity owns one map. Terminal observations replace proposals,
/// while disagreeing terminal maps lock a gap rather than accumulating paths.
pub(super) fn merge(old: &mut Operation, incoming: &mut Operation, report: &mut SourceReport) {
    let Some(next) = incoming.work.as_ref() else {
        return;
    };
    let Some(previous) = old.work.as_mut() else {
        old.work = incoming.work.take();
        return;
    };
    if previous.gaps.contains(&WorkGap::ConflictingObservation) {
        return;
    }
    if matches!(
        (&previous.data, &next.data),
        (WorkData::Command { .. }, WorkData::Command { .. })
    ) {
        if command::merge(previous, next) {
            super::matching::invalidate(&mut old.matching);
            issue(
                report,
                "operationWorkConflict",
                "同一命令操作的来源元数据冲突",
                incoming.evidence.first().cloned(),
            );
        }
        return;
    }
    if std::mem::discriminant(&previous.data) != std::mem::discriminant(&next.data) {
        previous.data = match previous.data {
            WorkData::FileChange { .. } => WorkData::FileChange { changes: None },
            WorkData::Command { .. } => WorkData::Command {
                cwd: None,
                source: None,
                parsed_commands: None,
            },
        };
        previous.gaps.push(WorkGap::ConflictingObservation);
        issue(
            report,
            "operationWorkConflict",
            "同一操作的来源工作类型冲突",
            incoming.evidence.first().cloned(),
        );
        return;
    }
    if previous.stage == WorkStage::Terminal && next.stage == WorkStage::Proposed {
        return;
    }
    if previous.stage == WorkStage::Proposed && next.stage == WorkStage::Terminal {
        old.work = incoming.work.take();
        return;
    }
    // Missing coverage can be completed by a same-stage explicit observation,
    // but an invalid or resource-limited observation must not be silently healed.
    let (WorkData::FileChange { changes: before }, WorkData::FileChange { changes: after }) =
        (&previous.data, &next.data)
    else {
        return;
    };
    if previous.gaps == [WorkGap::MissingChanges] && after.is_some() {
        old.work = incoming.work.take();
        return;
    }
    if next.gaps == [WorkGap::MissingChanges] {
        return;
    }
    if before != after || previous.gaps != next.gaps {
        previous.data = WorkData::FileChange { changes: None };
        for gap in next.gaps.iter().chain([&WorkGap::ConflictingObservation]) {
            if !previous.gaps.contains(gap) {
                previous.gaps.push(gap.clone());
            }
        }
        issue(
            report,
            "operationWorkConflict",
            "同一文件操作的来源变更范围冲突",
            incoming.evidence.first().cloned(),
        );
    }
}
