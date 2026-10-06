//! Field-local token evidence. Missing observations never repair explicit conflicts.
use super::{MAX_SAFE_INTEGER, TokenUsage};
use anyhow::{Result, ensure};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TokenField {
    Input,
    CacheRead,
    CacheCreate,
    Output,
    Reasoning,
    Total,
    RawInput,
}
impl TokenField {
    pub const ALL: [Self; 7] = [
        Self::Input,
        Self::CacheRead,
        Self::CacheCreate,
        Self::Output,
        Self::Reasoning,
        Self::Total,
        Self::RawInput,
    ];
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenFields<T> {
    pub input: T,
    pub cache_read: T,
    pub cache_create: T,
    pub output: T,
    pub reasoning: T,
    pub total: T,
    pub raw_input: T,
}
impl<T> TokenFields<T> {
    pub fn from_fn(mut get: impl FnMut(TokenField) -> T) -> Self {
        Self {
            input: get(TokenField::Input),
            cache_read: get(TokenField::CacheRead),
            cache_create: get(TokenField::CacheCreate),
            output: get(TokenField::Output),
            reasoning: get(TokenField::Reasoning),
            total: get(TokenField::Total),
            raw_input: get(TokenField::RawInput),
        }
    }
    pub fn get(&self, field: TokenField) -> &T {
        match field {
            TokenField::Input => &self.input,
            TokenField::CacheRead => &self.cache_read,
            TokenField::CacheCreate => &self.cache_create,
            TokenField::Output => &self.output,
            TokenField::Reasoning => &self.reasoning,
            TokenField::Total => &self.total,
            TokenField::RawInput => &self.raw_input,
        }
    }
    pub fn get_mut(&mut self, field: TokenField) -> &mut T {
        match field {
            TokenField::Input => &mut self.input,
            TokenField::CacheRead => &mut self.cache_read,
            TokenField::CacheCreate => &mut self.cache_create,
            TokenField::Output => &mut self.output,
            TokenField::Reasoning => &mut self.reasoning,
            TokenField::Total => &mut self.total,
            TokenField::RawInput => &mut self.raw_input,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum TokenUnavailableReason {
    Missing,
    Invalid,
    Conflicting,
    Indeterminate,
}

impl TokenUsage {
    pub fn get(&self, field: TokenField) -> Option<u64> {
        match field {
            TokenField::Input => self.input,
            TokenField::CacheRead => self.cache_read,
            TokenField::CacheCreate => self.cache_create,
            TokenField::Output => self.output,
            TokenField::Reasoning => self.reasoning,
            TokenField::Total => self.total,
            TokenField::RawInput => self.raw_input,
        }
    }
    pub fn set(&mut self, field: TokenField, value: Option<u64>) {
        *match field {
            TokenField::Input => &mut self.input,
            TokenField::CacheRead => &mut self.cache_read,
            TokenField::CacheCreate => &mut self.cache_create,
            TokenField::Output => &mut self.output,
            TokenField::Reasoning => &mut self.reasoning,
            TokenField::Total => &mut self.total,
            TokenField::RawInput => &mut self.raw_input,
        } = value;
    }
    /// For observations whose unavailable fields all have this established reason.
    pub fn unavailable_reasons(
        &self,
        reason: TokenUnavailableReason,
    ) -> TokenFields<Option<TokenUnavailableReason>> {
        TokenFields::from_fn(|field| self.get(field).is_none().then_some(reason))
    }
}

pub fn validate_token_observations(
    tokens: &TokenUsage,
    reasons: &TokenFields<Option<TokenUnavailableReason>>,
) -> Result<()> {
    for field in TokenField::ALL {
        ensure!(
            tokens.get(field).is_some() == reasons.get(field).is_none(),
            "token value/unavailable reason mismatch: {field:?}"
        );
        ensure!(
            tokens
                .get(field)
                .is_none_or(|value| value <= MAX_SAFE_INTEGER),
            "token value exceeds safe integer: {field:?}"
        );
    }
    Ok(())
}

/// Merge canonical measurements, preserving each field independently. Returns
/// whether this observation introduced a new explicit count contradiction.
pub fn merge_token_observations(
    current: &mut TokenUsage,
    reasons: &mut TokenFields<Option<TokenUnavailableReason>>,
    incoming: &TokenUsage,
    incoming_reasons: &TokenFields<Option<TokenUnavailableReason>>,
) -> bool {
    let mut conflict = false;
    for field in TokenField::ALL {
        let old_reason = reasons.get_mut(field);
        let new_reason = *incoming_reasons.get(field);
        let old = current.get(field);
        let new = incoming.get(field);
        if *old_reason == Some(TokenUnavailableReason::Conflicting)
            || new_reason == Some(TokenUnavailableReason::Conflicting)
            || old.zip(new).is_some_and(|(a, b)| a != b)
        {
            conflict |= *old_reason != Some(TokenUnavailableReason::Conflicting);
            current.set(field, None);
            *old_reason = Some(TokenUnavailableReason::Conflicting);
        } else if new.is_some() && old.is_none() {
            current.set(field, new);
            *old_reason = None;
        } else if old.is_none() {
            // A malformed observation gives more specific evidence than absence;
            // neither can establish the amount of an unresolved counter interval.
            let rank = |reason| match reason {
                Some(TokenUnavailableReason::Conflicting) => 4,
                Some(TokenUnavailableReason::Invalid) => 3,
                Some(TokenUnavailableReason::Indeterminate) => 2,
                Some(TokenUnavailableReason::Missing) => 1,
                None => 0,
            };
            if rank(new_reason) > rank(*old_reason) {
                *old_reason = new_reason;
            }
        }
    }
    conflict
}

#[cfg(test)]
mod tests;
