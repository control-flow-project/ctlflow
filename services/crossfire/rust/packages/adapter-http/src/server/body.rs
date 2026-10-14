use bytes::Bytes;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use http_body_util::{BodyExt, Full, Limited, combinators::BoxBody};
use hyper::body::Incoming;
use serde_json::Value;
pub type Body = BoxBody<Bytes, Failure>;
pub fn full(value: impl Into<Bytes>) -> Body {
    Full::new(value.into())
        .map_err(|never| match never {})
        .boxed()
}
pub fn empty() -> Body {
    full(Bytes::new())
}
pub async fn read(input: Incoming, maximum: usize) -> Result<Bytes> {
    if maximum == 0 || maximum > 64 * 1024 * 1024 {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid HTTP body resource bound",
        ));
    }
    Limited::new(input, maximum)
        .collect()
        .await
        .map(|body| body.to_bytes())
        .map_err(|error| {
            if error
                .downcast_ref::<http_body_util::LengthLimitError>()
                .is_some()
            {
                Failure::new(
                    ErrorCode::BodyTooLarge,
                    "Request body exceeds the configured bound",
                )
            } else {
                Failure::new(ErrorCode::Invalid, "HTTP body could not be read")
            }
        })
}
pub async fn json(input: Incoming, maximum: usize) -> Result<Value> {
    let bytes = read(input, maximum).await?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid JSON"))?;
    crate::validate_json(&value)?;
    Ok(value)
}
