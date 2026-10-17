use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Invalid,
    Unauthorized,
    Forbidden,
    Missing,
    Conflict,
    Limit,
    Native,
    Unavailable,
    StaleRevision,
    NameCollision,
    Capacity,
    RateLimit,
    BodyTooLarge,
    MethodNotAllowed,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::Unauthorized => "unauthorized",
            Self::Forbidden => "forbidden",
            Self::Missing => "missing",
            Self::Conflict => "conflict",
            Self::Limit => "limit",
            Self::Native => "native",
            Self::Unavailable => "unavailable",
            Self::StaleRevision => "stale_revision",
            Self::NameCollision => "name_collision",
            Self::Capacity => "capacity",
            Self::RateLimit => "rate_limit",
            Self::BodyTooLarge => "body_too_large",
            Self::MethodNotAllowed => "method_not_allowed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Failure {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<BTreeMap<String, String>>,
}

pub type Result<T> = std::result::Result<T, Failure>;

impl Failure {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            field_errors: None,
        }
    }

    pub fn field(mut self, name: &str) -> Self {
        let message = self.message.clone();
        self.message = format!("{name}: {message}");
        self.field_errors = Some(BTreeMap::from([(name.to_owned(), message)]));
        self
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}
