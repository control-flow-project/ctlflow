use crossfire_kernel::{Failure, failure::ErrorCode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_items: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_pages: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response<T> {
    pub data: T,
    pub meta: Metadata,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    pub error: Failure,
    pub meta: Metadata,
}

pub fn metadata(request_id: String) -> Metadata {
    Metadata {
        request_id,
        page: None,
        page_size: None,
        total_items: None,
        total_pages: None,
    }
}

pub fn http_status(code: ErrorCode) -> u16 {
    match code {
        ErrorCode::Invalid => 400,
        ErrorCode::Unauthorized => 401,
        ErrorCode::Forbidden => 403,
        ErrorCode::Missing => 404,
        ErrorCode::MethodNotAllowed => 405,
        ErrorCode::Conflict | ErrorCode::StaleRevision | ErrorCode::NameCollision => 409,
        ErrorCode::Limit | ErrorCode::BodyTooLarge => 413,
        ErrorCode::Capacity => 409,
        ErrorCode::RateLimit => 429,
        ErrorCode::Native => 502,
        ErrorCode::Unavailable => 503,
    }
}
