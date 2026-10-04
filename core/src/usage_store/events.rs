//! Safe source observations are stored once, separately from derived turn rows.
use super::*;
use crate::session_events::Event;
use std::collections::BTreeSet;

pub(super) fn validate(events: &[Arc<Event>]) -> Result<()> {
    let mut ids = BTreeSet::new();
    for event in events {
        if !ids.insert(event.id()) {
            return Err(operation_error("INVALID_FACTS", "事件身份重复"));
        }
    }
    Ok(())
}
impl Snapshot {
    pub fn events(&self) -> Result<Vec<Arc<Event>>> {
        if let Some(events) = &self.live_events {
            return Ok(events.clone());
        }
        let reference = &self.manifest.events;
        let bytes = bounded_read(&safe_file(&self.directory, &reference.file)?)?;
        if crate::hash(&bytes) != reference.sha256 {
            return Err(corrupt("事件分片校验失败"));
        }
        let events = serde_json::from_slice::<Vec<Arc<Event>>>(&bytes)
            .map_err(|e| corrupt(format!("事件分片无效：{e}")))?;
        validate(&events).map_err(|_| corrupt("事件身份重复"))?;
        Ok(events)
    }
}
