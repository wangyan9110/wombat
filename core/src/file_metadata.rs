//! Capture file identity and attributes together; creation time is not identity.
use std::{fs, io, path::Path, time::SystemTime};

#[derive(Clone)]
pub(crate) struct FileMetadata {
    metadata: fs::Metadata,
    pub(crate) physical: String,
}

impl FileMetadata {
    pub(crate) fn read(path: impl AsRef<Path>) -> io::Result<Self> {
        #[cfg(windows)]
        {
            Self::from_file(&fs::File::open(path)?)
        }
        #[cfg(not(windows))]
        {
            Ok(Self::from_metadata(fs::metadata(path)?))
        }
    }

    pub(crate) fn from_file(file: &fs::File) -> io::Result<Self> {
        let metadata = file.metadata()?;
        #[cfg(windows)]
        {
            // Safe maintained wrapper around GetFileInformationByHandle. Both
            // observations belong to this open handle, even during a rename.
            let info = winapi_util::file::information(file)?;
            Ok(Self {
                metadata,
                physical: format!("{}:{}", info.volume_serial_number(), info.file_index()),
            })
        }
        #[cfg(not(windows))]
        Ok(Self::from_metadata(metadata))
    }

    #[cfg(not(windows))]
    fn from_metadata(metadata: fs::Metadata) -> Self {
        #[cfg(unix)]
        let physical = {
            use std::os::unix::fs::MetadataExt;
            format!("{}:{}", metadata.dev(), metadata.ino())
        };
        #[cfg(not(unix))]
        let physical = format!("{:?}", metadata.created().ok());
        Self { metadata, physical }
    }

    pub(crate) fn len(&self) -> u64 {
        self.metadata.len()
    }

    pub(crate) fn is_file(&self) -> bool {
        self.metadata.is_file()
    }

    pub(crate) fn modified(&self) -> io::Result<SystemTime> {
        self.metadata.modified()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    use std::os::windows::fs::FileTimesExt;

    #[test]
    fn same_bytes_and_times_do_not_hide_replacement_or_rebind_open_handles() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("log");
        let replacement = root.path().join("replacement");
        fs::write(&path, b"same bytes").unwrap();
        let original = fs::File::open(&path).unwrap();
        let before = FileMetadata::from_file(&original).unwrap();
        fs::write(&replacement, b"same bytes").unwrap();
        let times = fs::FileTimes::new().set_modified(before.modified().unwrap());
        #[cfg(windows)]
        let times = times.set_created(original.metadata().unwrap().created().unwrap());
        fs::OpenOptions::new()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_times(times)
            .unwrap();
        fs::rename(&replacement, &path).unwrap();
        let after = FileMetadata::read(&path).unwrap();
        assert_eq!(before.len(), after.len());
        assert_eq!(before.modified().unwrap(), after.modified().unwrap());
        assert_ne!(before.physical, after.physical);
        assert_eq!(
            before.physical,
            FileMetadata::from_file(&original).unwrap().physical
        );
    }
}
