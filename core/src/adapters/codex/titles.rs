//! Optional session-index titles never determine usage or ownership.
use super::*;
pub(super) fn read_titles(root: &Path, facts: &mut Facts, report: &mut SourceReport) {
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
