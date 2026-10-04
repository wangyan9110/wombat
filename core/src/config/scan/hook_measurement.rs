//! Measure only the exact registered declaration text, never the referenced script.
use super::*;
impl Inventory {
    pub(super) fn hook_measurement(&mut self, row: &mut Item, text: Option<&str>, path: &Path) {
        let Some(text) = text else {
            row.bytes = None;
            row.bytes_source = None;
            row.characters = None;
            row.measurement_status = "declarationUnavailable".into();
            row.estimate_status = "estimateUnavailable".into();
            self.issue("hookDeclarationMeasurementUnavailable", path);
            return;
        };
        row.bytes = Some(text.len() as u64);
        row.characters = Some(text.chars().count() as u64);
        row.bytes_source = Some("hookDeclarationUtf8".into());
        row.measurement_status = "complete".into();
        let limited = text.len() > crate::config::measure::ESTIMATE_FILE_LIMIT
            || self.estimated.saturating_add(text.len())
                > crate::config::measure::ESTIMATE_ROUND_LIMIT;
        if !limited {
            self.estimated += text.len();
            row.estimate = crate::config::measure::estimate(text, &crate::hash(text));
            if let Some(estimate) = &mut row.estimate {
                estimate.payload = "hookDeclaration".into();
            }
        }
        row.content_tokens = row.estimate.as_ref().map(|e| e.tokens);
        row.estimate_status = if row.estimate.is_some() {
            "estimated"
        } else if limited {
            "resourceLimited"
        } else {
            "estimateUnavailable"
        }
        .into();
        if row.estimate.is_none() {
            self.issue(
                if limited {
                    "estimateLimited"
                } else {
                    "estimateUnavailable"
                },
                path,
            );
        }
    }
}
