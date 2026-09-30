use serde_json::Value;

#[derive(Debug)]
pub struct OperationError {
    pub code: &'static str,
    pub message: String,
    pub details: Option<Value>,
}
impl std::fmt::Display for OperationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(f)
    }
}
impl std::error::Error for OperationError {}
pub fn operation_error(code: &'static str, message: impl Into<String>) -> anyhow::Error {
    OperationError {
        code,
        message: message.into(),
        details: None,
    }
    .into()
}

pub fn operation_error_with_details(
    code: &'static str,
    message: impl Into<String>,
    details: Value,
) -> anyhow::Error {
    OperationError {
        code,
        message: message.into(),
        details: Some(details),
    }
    .into()
}
