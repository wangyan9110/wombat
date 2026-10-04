//! Borrowed live facts and exact persisted turn reads.
use super::*;
impl Snapshot {
    pub(crate) fn is_live(&self) -> bool {
        self.live_rows.is_some()
    }
    pub(crate) fn export_live(&self) -> Result<Snapshot> {
        let prices = crate::pricing_sync::current()?;
        if prices.catalog_hash != self.manifest.price_catalog_hash {
            return Err(operation_error(
                "PRICE_CHANGED",
                "价表已经更新，请重新同步后保存",
            ));
        }
        let rows = self
            .live_rows
            .as_ref()
            .ok_or_else(|| operation_error("INVALID_ARGUMENT", "只能导出实时读取版本"))?;
        let turns = self.memory_turns.as_ref().unwrap();
        let collected = Collected {
            sources: self.manifest.sources.clone(),
            issues: self.manifest.issues.clone(),
            threads: self
                .manifest
                .threads
                .iter()
                .map(|e| e.thread.clone())
                .collect(),
            turns: self
                .manifest
                .threads
                .iter()
                .flat_map(|e| e.turns.values().filter_map(|t| t.turn.clone()))
                .collect(),
            measurements: rows.iter().map(|r| r.fact.clone()).collect(),
            operations: turns
                .values()
                .flat_map(|t| t.operations.iter().cloned())
                .collect(),
        };
        save_with_prices(&product_home()?, collected, prices)
    }
    pub(crate) fn operation_facts(&self) -> impl Iterator<Item = &Arc<Operation>> {
        self.memory_turns
            .iter()
            .flat_map(|turns| turns.values().flat_map(|t| t.operations.iter()))
    }
    pub(crate) fn measurement_facts(&self) -> impl Iterator<Item = &Arc<Measurement>> {
        self.live_rows
            .iter()
            .flat_map(|rows| rows.iter().map(|r| &r.fact))
    }
    pub(crate) fn live_ledger(&self) -> Option<Vec<&PricedMeasurement>> {
        self.live_rows
            .as_ref()
            .map(|rows| rows.iter().map(Arc::as_ref).collect())
    }
    pub(crate) fn live_detail_rows(
        &self,
        thread_id: &str,
        turn_id: Option<&str>,
    ) -> Result<Option<Vec<&PricedMeasurement>>> {
        let (Some(turns), Some(rows)) = (&self.memory_turns, &self.live_rows) else {
            return Ok(None);
        };
        let thread = self
            .manifest
            .threads
            .iter()
            .find(|t| t.thread.id == thread_id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
        let ids = if let Some(turn_id) = turn_id {
            if !thread.turns.contains_key(turn_id) {
                return Err(operation_error("NOT_FOUND", "未找到轮次"));
            }
            vec![turn_id]
        } else {
            thread.turns.keys().map(String::as_str).collect()
        };
        Ok(Some(
            ids.into_iter()
                .filter_map(|id| turns.get(&(thread_id.into(), id.into())))
                .flat_map(|turn| turn.measurements.iter().map(|index| rows[*index].as_ref()))
                .collect(),
        ))
    }
    pub fn ledger(&self) -> Result<Vec<PricedMeasurement>> {
        if let Some(rows) = &self.live_rows {
            return Ok(rows.iter().map(|r| r.as_ref().clone()).collect());
        }
        let bytes = bounded_read(&safe_file(&self.directory, &self.manifest.ledger.file)?)?;
        if crate::hash(&bytes) != self.manifest.ledger.sha256 {
            return Err(corrupt("计量分片校验失败"));
        }
        serde_json::from_slice(&bytes).map_err(|e| corrupt(format!("计量分片无效：{e}")))
    }
    pub fn turn(&self, thread_id: &str, turn_id: &str) -> Result<TurnData> {
        if let Some(turns) = &self.memory_turns {
            let turn = turns
                .get(&(thread_id.into(), turn_id.into()))
                .ok_or_else(|| operation_error("NOT_FOUND", "未找到轮次"))?;
            let rows = self.live_rows.as_ref().unwrap();
            return Ok(TurnData {
                measurements: turn
                    .measurements
                    .iter()
                    .map(|id| rows[*id].as_ref().clone())
                    .collect(),
                operations: turn
                    .operations
                    .iter()
                    .map(|op| op.as_ref().clone())
                    .collect(),
            });
        }
        let thread = self
            .manifest
            .threads
            .iter()
            .find(|t| t.thread.id == thread_id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
        let entry = thread
            .turns
            .get(turn_id)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到轮次"))?;
        if entry.slice.length > MAX_FILE_BYTES {
            return Err(corrupt("轮次分片过大"));
        }
        let mut file = fs::File::open(safe_file(&self.directory, &thread.file.file)?)?;
        if entry
            .slice
            .offset
            .checked_add(entry.slice.length)
            .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
        {
            return Err(corrupt("轮次定位越界"));
        }
        file.seek(SeekFrom::Start(entry.slice.offset))?;
        let mut bytes = vec![0; entry.slice.length as usize];
        file.read_exact(&mut bytes)?;
        if crate::hash(&bytes) != entry.slice.sha256 {
            return Err(corrupt("轮次分片校验失败"));
        }
        serde_json::from_slice(&bytes).map_err(|e| corrupt(format!("轮次分片无效：{e}")))
    }
}
