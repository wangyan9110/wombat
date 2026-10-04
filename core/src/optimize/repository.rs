//! Private review database initialization and filesystem safeguards.
use super::store;
use crate::dto::operation_error;
use anyhow::Result;
use rusqlite::Connection;
use std::{fs, path::Path, time::Duration};
pub(super) fn connect(path: &Path) -> Result<Connection> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path.parent().unwrap())?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(path)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(operation_error(
                    "REVIEWS_UNAVAILABLE",
                    "处理记录不是普通文件",
                ));
            }
        }
        Err(e) => return Err(e.into()),
    }
    let mut db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    store::initialize(&mut db)?;
    Ok(db)
}
