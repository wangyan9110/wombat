//! Per immutable snapshot, typed local results only. Share aliases are never cached.
use crate::timing_dto::LocalResponse;
use std::{collections::VecDeque, io::Write, sync::atomic::AtomicBool};
const ENTRIES: usize = 16;
const TOTAL_BYTES: usize = 2 * 1024 * 1024;
const ENTRY_BYTES: usize = 256 * 1024;
#[derive(Default)]
pub(crate) struct Cache {
    entries: VecDeque<(String, LocalResponse, usize)>,
    bytes: usize,
}
struct Size<'a>(usize, &'a AtomicBool);
impl Write for Size<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.1.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(std::io::Error::other("cache cancelled"));
        }
        self.0 = self.0.saturating_add(bytes.len());
        if self.0 > ENTRY_BYTES {
            return Err(std::io::Error::other("cache entry budget"));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl Cache {
    pub(crate) fn get(&mut self, key: &str) -> Option<LocalResponse> {
        let index = self.entries.iter().position(|(entry, _, _)| entry == key)?;
        let entry = self.entries.remove(index)?;
        let result = entry.1.clone();
        self.entries.push_back(entry);
        Some(result)
    }
    #[cfg(test)]
    pub(crate) fn insert(&mut self, key: String, value: LocalResponse) -> bool {
        self.insert_cancellable(key, value, &AtomicBool::new(false))
            .unwrap()
    }
    pub(crate) fn insert_cancellable(
        &mut self,
        key: String,
        mut value: LocalResponse,
        cancelled: &AtomicBool,
    ) -> anyhow::Result<bool> {
        super::analysis::check(cancelled)?;
        if value.quality.partial || value.quality.running {
            return Ok(false);
        }
        // Freshness belongs to this invocation, never the immutable computation.
        value.freshness = Default::default();
        let mut size = Size(key.len(), cancelled);
        if serde_json::to_writer(&mut size, &value).is_err() || size.0 > ENTRY_BYTES {
            super::analysis::check(cancelled)?;
            return Ok(false);
        }
        super::analysis::check(cancelled)?;
        if let Some(index) = self.entries.iter().position(|(entry, _, _)| entry == &key) {
            self.bytes -= self.entries.remove(index).unwrap().2;
        }
        while self.entries.len() >= ENTRIES || self.bytes + size.0 > TOTAL_BYTES {
            self.bytes -= self.entries.pop_front().unwrap().2;
        }
        self.bytes += size.0;
        self.entries.push_back((key, value, size.0));
        Ok(true)
    }
}
