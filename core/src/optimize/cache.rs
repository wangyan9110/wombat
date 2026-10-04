//! Process-local pure judgments. Authorization is part of the key, never user history.
//! Byte caps charge encodings, not Rust allocation overhead or RSS.
//! This evaluator currently has no cancellation token. Future transport cancellation
//! must guard cache admission as well as result publication.
use super::evaluation::Assessment;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Mutex, OnceLock},
};

pub(super) const MAX_ENTRIES: usize = 16;
pub(super) const MAX_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_ENTRY_BYTES: usize = 256 * 1024;

struct BudgetWriter {
    bytes: usize,
    limit: usize,
    hash: Sha256,
}
impl Write for BudgetWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes) {
            return Err(io::Error::other("rule cache encoding budget exceeded"));
        }
        self.bytes += bytes.len();
        self.hash.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
/// Oversized keys skip reuse; encoding stops at the cap without a full JSON buffer.
pub(super) fn key(facts: &impl Serialize, limit: usize) -> Option<String> {
    let mut writer = BudgetWriter {
        bytes: 0,
        limit: limit.min(MAX_ENTRY_BYTES),
        hash: Sha256::new(),
    };
    serde_json::to_writer(&mut writer, facts).ok()?;
    Some(format!("{:x}", writer.hash.finalize()))
}
pub(super) struct Entry {
    key: String,
    judgment: Assessment,
    bytes: usize,
}
impl Entry {
    pub(super) fn new(key: String, judgment: &Assessment) -> Option<Self> {
        if !matches!(judgment, Assessment::Hit(_) | Assessment::Miss) || key.len() > MAX_ENTRY_BYTES
        {
            return None;
        }
        let mut writer = BudgetWriter {
            bytes: key.len(),
            limit: MAX_ENTRY_BYTES,
            hash: Sha256::new(),
        };
        serde_json::to_writer(&mut writer, judgment).ok()?;
        Some(Self {
            key,
            judgment: judgment.clone(),
            bytes: writer.bytes,
        })
    }
}
#[derive(Default)]
pub(super) struct JudgmentCache {
    entries: VecDeque<Entry>,
    bytes: usize,
    #[cfg(test)]
    hits: usize,
}
impl JudgmentCache {
    pub(super) fn get(&mut self, key: &str) -> Option<Assessment> {
        let index = self.entries.iter().position(|entry| entry.key == key)?;
        let entry = self.entries.remove(index)?;
        #[cfg(test)]
        {
            self.hits += 1;
        }
        let judgment = entry.judgment.clone();
        self.entries.push_back(entry);
        Some(judgment)
    }
    #[cfg(test)]
    pub(super) fn stats(&self) -> (usize, usize, usize) {
        (self.entries.len(), self.bytes, self.hits)
    }
    pub(super) fn insert(&mut self, entry: Entry) {
        if let Some(index) = self.entries.iter().position(|old| old.key == entry.key) {
            self.bytes -= self.entries.remove(index).expect("located entry").bytes;
        }
        while self.entries.len() >= MAX_ENTRIES || self.bytes + entry.bytes > MAX_BYTES {
            let Some(old) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= old.bytes;
        }
        self.bytes += entry.bytes;
        self.entries.push_back(entry);
    }
}
pub(super) fn shared() -> &'static Mutex<JudgmentCache> {
    static CACHE: OnceLock<Mutex<JudgmentCache>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}
#[cfg(test)]
mod tests;
