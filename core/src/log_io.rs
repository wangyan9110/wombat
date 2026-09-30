use anyhow::Result;
use memmap2::{Mmap, MmapOptions};
use std::{
    fs::File,
    io::{BufRead, Write},
};

const MEMORY_LINE: usize = 1_000_000;
pub enum Line<'a> {
    Memory(&'a [u8]),
    Mapped { map: Mmap, _file: File },
}
impl Line<'_> {
    pub fn bytes(&self) -> &[u8] {
        match self {
            Self::Memory(bytes) => bytes,
            Self::Mapped { map, .. } => map,
        }
    }
}

// Ordinary records reuse one buffer. Large records spill to an anonymous tempfile, which the OS
// removes when its handle closes, including cancellation. The original log is never mapped/mutated.
pub fn next_line<'a>(
    reader: &mut impl BufRead,
    buffer: &'a mut Vec<u8>,
) -> Result<Option<Line<'a>>> {
    buffer.clear();
    let mut disk: Option<File> = None;
    let mut any = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            if !any {
                return Ok(None);
            }
            break;
        }
        any = true;
        let end = memchr::memchr(b'\n', chunk).map(|index| index + 1);
        let count = end.unwrap_or(chunk.len());
        if disk.is_none() && buffer.len() + count > MEMORY_LINE {
            let mut file = tempfile::tempfile()?;
            file.write_all(buffer)?;
            buffer.clear();
            disk = Some(file);
        }
        if let Some(file) = disk.as_mut() {
            file.write_all(&chunk[..count])?;
        } else {
            buffer.extend_from_slice(&chunk[..count]);
        }
        reader.consume(count);
        if end.is_some() {
            break;
        }
    }
    if let Some(file) = disk {
        // SAFETY: this anonymous private file is exclusively owned here. All writes are complete;
        // no code can truncate or mutate it while the read-only mapping exists. Map drops first.
        let map = unsafe { MmapOptions::new().map(&file)? };
        Ok(Some(Line::Mapped { map, _file: file }))
    } else {
        Ok(Some(Line::Memory(buffer)))
    }
}
