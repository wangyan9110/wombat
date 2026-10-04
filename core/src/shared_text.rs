//! Bounded exact text sharing for immutable metadata; overflow preserves full values.
use std::{collections::HashSet, sync::Arc};
const MAX_ENTRIES: usize = 4096;
const MAX_BYTES: usize = 1024 * 1024;
const MAX_STRING_BYTES: usize = 1024;

#[derive(Default)]
pub(crate) struct SharedText {
    values: HashSet<Arc<str>>,
    bytes: usize,
}

impl SharedText {
    pub(crate) fn share(&mut self, value: &mut Arc<str>) {
        if value.len() > MAX_STRING_BYTES {
            return;
        }
        if let Some(existing) = self.values.get(value.as_ref()) {
            *value = Arc::clone(existing);
        } else if self.values.len() < MAX_ENTRIES && self.bytes + value.len() <= MAX_BYTES {
            self.bytes += value.len();
            self.values.insert(Arc::clone(value));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exhausted_budgets_and_large_unicode_values_preserve_exact_contents() {
        for width in [10, 1024] {
            let mut pool = SharedText::default();
            let mut first: Arc<str> = "same".into();
            pool.share(&mut first);
            for i in 0..5000 {
                let expected = format!("{i:08}{}", "x".repeat(width - 8));
                let mut value: Arc<str> = expected.as_str().into();
                pool.share(&mut value);
                assert_eq!(value.as_ref(), expected);
            }
            assert!(pool.values.len() <= MAX_ENTRIES);
            assert!(pool.bytes <= MAX_BYTES);
            let count = pool.values.len();
            let mut same: Arc<str> = "same".into();
            pool.share(&mut same);
            assert!(Arc::ptr_eq(&same, &first));
            let expected = "任务".repeat(300);
            let mut large: Arc<str> = expected.as_str().into();
            pool.share(&mut large);
            assert_eq!(large.as_ref(), expected);
            assert_eq!(pool.values.len(), count);
        }
    }
}
