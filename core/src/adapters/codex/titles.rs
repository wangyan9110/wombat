//! Optional session-index titles never determine usage or ownership.
use super::*;
use crate::file_metadata::FileMetadata;
use crate::session_events::title_observations::{TITLE_OBSERVATION_VERSION, TitleObservation};

pub(super) fn apply_titles(facts: &mut Facts) {
    for thread in facts.threads.values_mut() {
        thread.title = facts
            .title_observations
            .get(&thread.id)
            .map(|o| o.title.clone());
    }
}

pub(super) fn read_titles(root: &Path, facts: &mut Facts, report: &mut SourceReport) {
    let previously_observed = !facts.title_observations.is_empty();
    // A replaced log can revoke a thread even when its optional title index is
    // unavailable. Only observations for current source-local threads survive.
    facts.title_observations.retain(|id, observation| {
        observation.source_instance_id == report.source.id
            && facts
                .threads
                .get(id)
                .is_some_and(|thread| thread.source_instance_id == observation.source_instance_id)
    });
    #[derive(Deserialize)]
    struct Title {
        id: String,
        thread_name: String,
        updated_at: String,
    }
    let path = root.join("session_index.jsonl");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if previously_observed {
                issue(
                    report,
                    "titleMissing",
                    "对话标题索引已不可用，保留既有观察",
                    None,
                );
            }
            return;
        }
        Err(_) => {
            issue(report, "titleUnreadable", "无法读取对话标题索引", None);
            return;
        }
    };
    let identity = |meta: FileMetadata| {
        (
            incremental::physical_identity(&meta),
            meta.len(),
            meta.modified().ok(),
        )
    };
    let before = FileMetadata::from_file(&file).ok().map(&identity);
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    let mut selected = BTreeMap::<String, TitleObservation>::new();
    let mut bytes = 0;
    let observed_at = chrono::Utc::now().to_rfc3339();
    let mut complete = true;
    loop {
        let row = match crate::log_io::next_line(&mut reader, &mut buffer) {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(_) => {
                issue(report, "titleUnreadable", "对话标题索引读取中断", None);
                complete = false;
                break;
            }
        };
        bytes += row.bytes().len();
        if bytes > 8 * 1024 * 1024 {
            issue(report, "resourceLimit", "对话标题索引超过 8 MiB", None);
            complete = false;
            break;
        }
        let Ok(title) = serde_json::from_slice::<Title>(row.bytes()) else {
            issue(report, "invalidTitle", "对话标题索引有无效记录", None);
            complete = false;
            continue;
        };
        let Some(updated) = timestamp(Some(&title.updated_at)) else {
            issue(report, "invalidTitle", "对话标题索引缺少有效更新时间", None);
            complete = false;
            continue;
        };
        let id = stable_id(&["codex", &report.source.id, "thread", &title.id]);
        if !facts.threads.contains_key(&id)
            || selected
                .get(&id)
                .is_some_and(|old| old.source_updated_at > updated)
        {
            continue;
        }
        selected.insert(
            id.clone(),
            TitleObservation {
                version: TITLE_OBSERVATION_VERSION,
                source_instance_id: report.source.id.clone(),
                file_id: crate::hash(path.to_string_lossy().as_bytes()),
                thread_id: id,
                source_updated_at: updated,
                observed_at: observed_at.clone(),
                title: safe_text(&title.thread_name).chars().take(160).collect(),
            },
        );
    }
    // A complete replacement may roll its source timestamp backwards or remove a
    // title. An incomplete read cannot establish absence or replace prior facts.
    if !complete {
        return;
    }
    if before.is_none()
        || before
            != FileMetadata::from_file(reader.get_ref())
                .ok()
                .map(&identity)
        || before != FileMetadata::read(&path).ok().map(&identity)
    {
        issue(
            report,
            "titleUnreadable",
            "对话标题索引读取期间发生变化，保留既有观察",
            None,
        );
        return;
    }
    for (id, observation) in &mut selected {
        if let Some(old) = facts.title_observations.get(id)
            && old.source_updated_at == observation.source_updated_at
            && old.title == observation.title
            && old.file_id == observation.file_id
        {
            observation.observed_at.clone_from(&old.observed_at);
        }
    }
    facts.title_observations = selected;
}
