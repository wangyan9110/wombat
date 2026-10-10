//! Durable settings and notifications are independent of rebuildable usage indexes.
use super::*;
pub(super) fn open(file: &std::path::Path) -> Result<Connection> {
    crate::storage::private_file(file)?;
    let file = dunce::canonicalize(file)?;
    let mut db = Connection::open_with_flags(
        file,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(500))?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == 0 {
        let occupied:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%')",[],|r|r.get(0))?;
        if occupied {
            return Err(operation_error(
                "UNSUPPORTED_VERSION",
                "Unknown monitor format",
            ));
        }
        tx.execute_batch("CREATE TABLE plans(id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE notifications(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,plan_id TEXT NOT NULL,payload TEXT NOT NULL,acknowledged INTEGER NOT NULL);PRAGMA user_version=1;")?;
    } else if version != 1 {
        return Err(operation_error(
            "UNSUPPORTED_VERSION",
            "Unknown monitor format; data preserved",
        ));
    }
    tx.commit()?;
    Ok(db)
}
