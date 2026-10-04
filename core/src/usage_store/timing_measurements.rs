//! Read one canonical turn slice; skip operation payloads without allocating them.
use super::timing_evidence::{Meter, TurnTarget};
use super::*;
use serde::{
    de::{DeserializeSeed, MapAccess, SeqAccess, Visitor},
    ser::SerializeSeq,
};
use sha2::{Digest, Sha256};
use std::{fmt, io};

struct LiveRows<'a> {
    indices: &'a [usize],
    rows: &'a [Arc<PricedMeasurement>],
}
impl Serialize for LiveRows<'_> {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.indices.len()))?;
        for index in self.indices {
            seq.serialize_element(&self.rows[*index])?;
        }
        seq.end()
    }
}
#[derive(Serialize)]
struct LiveTurn<'a> {
    measurements: LiveRows<'a>,
    operations: &'a [Arc<Operation>],
}
struct Writer<'a, 'b>(&'a mut Meter<'b>);
impl io::Write for Writer<'_, '_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.bytes(bytes.len() as u64).map_err(io::Error::other)?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn failure(meter: &mut Meter<'_>, error: impl fmt::Display) -> anyhow::Error {
    match meter.failure {
        Some("CANCELLED") => operation_error("CANCELLED", "轮次证据读取已取消"),
        Some("RESOURCE_LIMIT") => operation_error("RESOURCE_LIMIT", "轮次证据读取超过资源预算"),
        _ => corrupt(format!("轮次计量分片无效：{error}")),
    }
}
fn exact(fact: &Measurement, target: TurnTarget<'_>) -> bool {
    fact.source_instance_id.as_ref() == target.source
        && fact.thread_id.as_deref() == Some(target.thread)
        && fact.turn_id.as_deref() == Some(target.turn)
}
struct Facts<'a, 'b> {
    meter: &'a mut Meter<'b>,
    target: TurnTarget<'a>,
}
impl<'de> DeserializeSeed<'de> for Facts<'_, '_> {
    type Value = Vec<Arc<Measurement>>;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        d: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        d.deserialize_seq(self)
    }
}
impl<'de> Visitor<'de> for Facts<'_, '_> {
    type Value = Vec<Arc<Measurement>>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded canonical measurements")
    }
    fn visit_seq<A: SeqAccess<'de>>(
        self,
        mut seq: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut out = vec![];
        // Each seed charges before parsing or allocating the next fact.
        while let Some(row) = seq.next_element_seed(OneFact { meter: self.meter })? {
            if !exact(&row.fact, self.target) {
                return Err(serde::de::Error::custom("measurement attribution mismatch"));
            }
            out.push(row.fact);
        }
        Ok(out)
    }
}
struct OneFact<'a, 'b> {
    meter: &'a mut Meter<'b>,
}
impl<'de> DeserializeSeed<'de> for OneFact<'_, '_> {
    type Value = PricedMeasurement;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        d: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        self.meter.facts(1).map_err(serde::de::Error::custom)?;
        PricedMeasurement::deserialize(d)
    }
}
struct Operations<'a, 'b>(&'a mut Meter<'b>);
impl<'de> DeserializeSeed<'de> for Operations<'_, '_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> std::result::Result<(), D::Error> {
        d.deserialize_seq(self)
    }
}
impl<'de> Visitor<'de> for Operations<'_, '_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded operations")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<(), A::Error> {
        while seq.next_element_seed(SkipOperation(self.0))?.is_some() {}
        Ok(())
    }
}
struct SkipOperation<'a, 'b>(&'a mut Meter<'b>);
impl<'de> DeserializeSeed<'de> for SkipOperation<'_, '_> {
    type Value = serde::de::IgnoredAny;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        d: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        self.0.facts(1).map_err(serde::de::Error::custom)?;
        serde::de::IgnoredAny::deserialize(d)
    }
}
struct TurnSlice<'a, 'b> {
    meter: &'a mut Meter<'b>,
    target: TurnTarget<'a>,
}
impl<'de> DeserializeSeed<'de> for TurnSlice<'_, '_> {
    type Value = Vec<Arc<Measurement>>;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        d: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}
impl<'de> Visitor<'de> for TurnSlice<'_, '_> {
    type Value = Vec<Arc<Measurement>>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("canonical turn data")
    }
    fn visit_map<A: MapAccess<'de>>(
        self,
        mut map: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut measurements = None;
        let mut operations = false;
        while let Some(key) = map.next_key::<String>()? {
            self.meter.check().map_err(serde::de::Error::custom)?;
            match key.as_str() {
                "measurements" if measurements.is_none() => {
                    measurements = Some(map.next_value_seed(Facts {
                        meter: self.meter,
                        target: self.target,
                    })?)
                }
                "operations" if !operations => {
                    map.next_value_seed(Operations(self.meter))?;
                    operations = true;
                }
                _ => {
                    return Err(serde::de::Error::custom(
                        "unexpected or duplicate turn field",
                    ));
                }
            }
        }
        if !operations {
            return Err(serde::de::Error::missing_field("operations"));
        }
        measurements.ok_or_else(|| serde::de::Error::missing_field("measurements"))
    }
}
impl Snapshot {
    pub(super) fn timing_measurements(
        &self,
        owner: &ThreadEntry,
        entry: &TurnEntry,
        target: TurnTarget<'_>,
        meter: &mut Meter<'_>,
    ) -> Result<Vec<Arc<Measurement>>> {
        meter.check()?;
        if let Some(turns) = &self.memory_turns {
            let data = turns
                .get(&(target.thread.into(), target.turn.into()))
                .ok_or_else(|| corrupt("轮次计量索引缺失"))?;
            let rows = self
                .live_rows
                .as_ref()
                .ok_or_else(|| corrupt("轮次计量事实缺失"))?;
            meter.facts(
                data.measurements
                    .len()
                    .checked_add(data.operations.len())
                    .ok_or_else(|| corrupt("轮次记录数量溢出"))?,
            )?;
            let value = LiveTurn {
                measurements: LiveRows {
                    indices: &data.measurements,
                    rows,
                },
                operations: &data.operations,
            };
            serde_json::to_writer(Writer(meter), &value).map_err(|e| failure(meter, e))?;
            meter.bytes(1)?; // Persisted slices include one trailing newline.
            let mut out = Vec::with_capacity(data.measurements.len());
            for index in &data.measurements {
                meter.check()?;
                let row = rows
                    .get(*index)
                    .ok_or_else(|| corrupt("轮次计量索引越界"))?;
                if !exact(&row.fact, target) {
                    return Err(corrupt("轮次计量归属不匹配"));
                }
                out.push(row.fact.clone());
            }
            return Ok(out);
        }
        meter.bytes(entry.slice.length)?;
        let mut file = fs::File::open(safe_file(&self.directory, &owner.file.file)?)
            .map_err(|e| corrupt(format!("轮次计量分片无法读取：{e}")))?;
        if entry
            .slice
            .offset
            .checked_add(entry.slice.length)
            .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
        {
            return Err(corrupt("轮次定位越界"));
        }
        file.seek(SeekFrom::Start(entry.slice.offset))?;
        let size = usize::try_from(entry.slice.length).map_err(|_| corrupt("轮次长度超出范围"))?;
        let mut bytes = vec![0; size];
        let mut hash = Sha256::new();
        for chunk in bytes.chunks_mut(64 * 1024) {
            meter.check()?;
            file.read_exact(chunk)
                .map_err(|e| corrupt(format!("轮次计量分片无法读取：{e}")))?;
            hash.update(&*chunk);
        }
        meter.check()?;
        if format!("{:x}", hash.finalize()) != entry.slice.sha256 {
            return Err(corrupt("轮次分片校验失败"));
        }
        let mut deserializer = serde_json::Deserializer::from_slice(&bytes);
        let out = TurnSlice { meter, target }
            .deserialize(&mut deserializer)
            .map_err(|e| failure(meter, e))?;
        deserializer
            .end()
            .map_err(|e| corrupt(format!("轮次计量尾部无效：{e}")))?;
        meter.check()?;
        Ok(out)
    }
}
