//! Shared type-7 sample quantile, used by timing and usage populations.
pub(crate) fn quantile(sorted: &[f64], probability: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let h = (sorted.len() - 1) as f64 * probability;
    let lower = h.floor() as usize;
    let upper = h.ceil() as usize;
    Some(sorted[lower] + (sorted[upper] - sorted[lower]) * (h - lower as f64))
}
