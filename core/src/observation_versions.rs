//! Current observation mappings and derived association versions shared by durable stores.

use anyhow::Result;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ObservationKind {
    Event,
    Title,
    Work,
    Message,
    Measurement,
    Operation,
    Association,
}

impl ObservationKind {
    pub(crate) const fn field(self) -> &'static str {
        match self {
            Self::Event => "eventObservationVersion",
            Self::Title => "titleObservationVersion",
            Self::Work => "workObservationVersion",
            Self::Message => "messageObservationVersion",
            Self::Measurement => "measurementObservationVersion",
            Self::Operation => "operationObservationVersion",
            Self::Association => "operationAssociationVersion",
        }
    }

    pub(crate) const fn current(self) -> u32 {
        match self {
            Self::Event => crate::session_events::EVENT_VERSION,
            Self::Title => crate::session_events::title_observations::TITLE_OBSERVATION_VERSION,
            Self::Work => crate::adapters::codex::incremental::WORK_OBSERVATION_VERSION,
            Self::Message => crate::adapters::codex::incremental::MESSAGE_OBSERVATION_VERSION,
            Self::Measurement => {
                crate::adapters::codex::incremental::MEASUREMENT_OBSERVATION_VERSION
            }
            Self::Operation => crate::adapters::codex::incremental::OPERATION_OBSERVATION_VERSION,
            Self::Association => crate::operation_association::METHOD_VERSION,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ObservationHeaderSet {
    Parser,
    Projection,
    Snapshot,
}

const SOURCE_HEADERS: &[ObservationKind] = &[
    ObservationKind::Operation,
    ObservationKind::Association,
    ObservationKind::Event,
    ObservationKind::Title,
    ObservationKind::Work,
    ObservationKind::Message,
    ObservationKind::Measurement,
];
const SNAPSHOT_HEADERS: &[ObservationKind] = &[
    ObservationKind::Event,
    ObservationKind::Message,
    ObservationKind::Measurement,
    ObservationKind::Operation,
    ObservationKind::Association,
    ObservationKind::Title,
];

impl ObservationHeaderSet {
    pub(crate) const fn kinds(self) -> &'static [ObservationKind] {
        match self {
            Self::Parser | Self::Projection => SOURCE_HEADERS,
            Self::Snapshot => SNAPSHOT_HEADERS,
        }
    }

    pub(crate) fn write_json(self, object: &mut Map<String, Value>) {
        for kind in self.kinds() {
            object.insert(kind.field().to_owned(), Value::from(kind.current()));
        }
    }

    pub(crate) fn validate_json(
        self,
        raw: &Value,
        mut message: impl FnMut(ObservationKind) -> &'static str,
    ) -> Result<()> {
        for &kind in self.kinds() {
            kind.validate_json(raw, message(kind))?;
        }
        Ok(())
    }

    pub(crate) fn validate_index(
        self,
        mut read: impl FnMut(&str) -> Result<Option<Value>>,
        mut message: impl FnMut(ObservationKind) -> &'static str,
    ) -> Result<()> {
        for &kind in self.kinds() {
            if read(kind.field())?.and_then(|value| value.as_u64())
                != Some(u64::from(kind.current()))
            {
                return Err(crate::dto::operation_error(
                    "UNSUPPORTED_VERSION",
                    message(kind),
                ));
            }
        }
        Ok(())
    }
}

/// Named snapshot values keep the public manifest fields while giving both
/// in-memory and on-disk constructors one source for the flat dependency headers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotObservationVersions {
    pub event_observation_version: u32,
    pub message_observation_version: u32,
    pub measurement_observation_version: u32,
    pub operation_observation_version: u32,
    pub operation_association_version: u32,
    pub title_observation_version: u32,
}

impl SnapshotObservationVersions {
    pub(crate) const fn current() -> Self {
        Self {
            event_observation_version: ObservationKind::Event.current(),
            message_observation_version: ObservationKind::Message.current(),
            measurement_observation_version: ObservationKind::Measurement.current(),
            operation_observation_version: ObservationKind::Operation.current(),
            operation_association_version: ObservationKind::Association.current(),
            title_observation_version: ObservationKind::Title.current(),
        }
    }
}

impl ObservationKind {
    pub(crate) fn validate_json(self, raw: &Value, message: &'static str) -> Result<()> {
        if raw[self.field()].as_u64() == Some(u64::from(self.current())) {
            Ok(())
        } else {
            Err(crate::dto::operation_error("UNSUPPORTED_VERSION", message))
        }
    }
}

#[cfg(test)]
mod tests;
