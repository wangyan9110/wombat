//! Bounded rollout reads, unchanged-file checks and parser boundaries.
use super::*;
#[derive(Default, Serialize, Deserialize)]
pub(super) struct State {
    pub(super) event_generation: Option<String>,
    pub(super) thread: Option<String>,
    pub(super) turn: Option<String>,
    pub(super) model: ModelRef,
    pub(super) effort: Option<String>,
    pub(super) thread_model: ModelRef,
    pub(super) thread_effort: Option<String>,
    pub(super) previous: Option<TokenUsage>,
    pub(super) ordinal: u64,
    pub(super) epoch: u64,
    pub(super) uncertain_counter: bool,
    pub(super) available_skills: BTreeMap<String, String>,
    pub(super) turn_had_operation: bool,
}
impl State {
    pub(super) fn break_context(&mut self) {
        self.turn = None;
        self.model = ModelRef::default();
        self.effort = None;
        self.thread_model = ModelRef::default();
        self.thread_effort = None;
        self.previous = None;
        self.available_skills.clear();
        self.turn_had_operation = false;
        self.epoch += 1;
    }
    pub(super) fn corrupt_boundary(&mut self) {
        self.break_context();
        self.uncertain_counter = true;
    }
}

pub(super) fn timestamp(text: Option<&str>) -> Option<String> {
    crate::session_events::Time::from_source(text).0.timestamp
}
pub(super) fn precision(text: Option<&str>) -> String {
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

pub(super) fn read_file(
    path: &Path,
    source: &SourceInstance,
    context: &RunContext,
    facts: &mut Facts,
    report: &mut SourceReport,
) {
    read_file_from(path, source, context, facts, report, None);
}

pub(super) fn read_file_from(
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
        let generation = state
            .event_generation
            .get_or_insert_with(|| {
                let physical = before.as_ref().map(incremental::physical_identity);
                crate::hash(
                    serde_json::to_vec(&(physical, &fingerprint)).expect("serializable identity"),
                )
            })
            .clone();
        let position = crate::session_events::Position {
            source_instance_id: source.id.clone(),
            file_id: crate::hash(evidence_path.as_bytes()),
            generation,
            byte_offset: consumed - row.bytes().len() as u64,
            ordinal: 0,
        };
        process(
            position,
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
pub(super) fn file_changed(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() != b.dev()
        || a.ino() != b.ino()
        || (a.len() == b.len() && a.modified().ok() != b.modified().ok())
}
#[cfg(not(unix))]
pub(super) fn file_changed(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.len() == b.len() && a.modified().ok() != b.modified().ok()
}
