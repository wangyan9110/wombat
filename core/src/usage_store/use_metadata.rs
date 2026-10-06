//! Same-pass membership observations; counts cover committed records, not unlogged activity.
use super::*;
use crate::usage_observations::{self, UseKind};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnassignedUseRecords {
    pub method_version: u32,
    pub skill_records: usize,
    pub mcp_records: usize,
}
impl Default for UnassignedUseRecords {
    fn default() -> Self {
        Self {
            method_version: usage_observations::METHOD_VERSION,
            skill_records: 0,
            mcp_records: 0,
        }
    }
}
impl UnassignedUseRecords {
    pub(super) fn observe(&mut self, operation: &Operation) -> Result<()> {
        if operation
            .turn_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
        {
            return Ok(());
        }
        let count = match usage_observations::use_kind(operation) {
            Some(UseKind::SkillRead) => &mut self.skill_records,
            Some(UseKind::McpTool | UseKind::McpResource) => &mut self.mcp_records,
            None if usage_observations::is_skill_read_candidate(operation) => {
                &mut self.skill_records
            }
            None if matches!(operation.kind.as_ref(), "mcpConflict" | "mcpUnclassified") => {
                &mut self.mcp_records
            }
            None => return Ok(()),
        };
        *count = count
            .checked_add(1)
            .ok_or_else(|| operation_error("RESOURCE_LIMIT", "未归属使用记录数量溢出"))?;
        Ok(())
    }
    pub(super) fn check_version(&self) -> Result<()> {
        check_version(Some(u64::from(self.method_version)))
    }
}
fn check_version(version: Option<u64>) -> Result<()> {
    if version.is_some_and(|version| version != u64::from(usage_observations::METHOD_VERSION)) {
        return Err(operation_error(
            "UNSUPPORTED_VERSION",
            "不支持此使用归属索引版本",
        ));
    }
    Ok(())
}
pub(super) fn check_headers(raw: &serde_json::Value) -> Result<()> {
    if let Some(threads) = raw.get("threads").and_then(serde_json::Value::as_array) {
        for entry in threads {
            check_version(entry["unassignedUses"]["methodVersion"].as_u64())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
