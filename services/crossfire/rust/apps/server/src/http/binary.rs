use crate::security;
use crossfire_adapter_http::server::{HeaderMap, Incoming};
use crossfire_domain::publication::port::BinarySource;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use http_body_util::BodyExt;

pub struct Input {
    source: Incoming,
    length: i64,
    received: i64,
}
impl Input {
    pub fn new(headers: &HeaderMap, source: Incoming, maximum: usize) -> Result<Self> {
        if security::single(headers, "content-type")? != Some("application/octet-stream") {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Expected application/octet-stream",
            ));
        }
        let value = security::single(headers, "content-length")?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "An exact Content-Length is required for binary input",
            )
        })?;
        if value.is_empty()
            || value.len() > 16
            || !value.bytes().all(|value| value.is_ascii_digit())
            || value.len() > 1 && value.starts_with('0')
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "An exact Content-Length is required for binary input",
            ));
        }
        let length = value
            .parse::<i64>()
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid binary length"))?;
        if length > maximum as i64 {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Binary request exceeds its operation bound",
            ));
        }
        Ok(Self {
            source,
            length,
            received: 0,
        })
    }
}
impl BinarySource for Input {
    fn length(&self) -> i64 {
        self.length
    }
    async fn next(&mut self) -> Result<Option<Vec<u8>>> {
        while let Some(frame) = self.source.frame().await {
            let frame = frame
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Binary input could not be read"))?;
            if let Ok(data) = frame.into_data() {
                self.received += data.len() as i64;
                if self.received > self.length {
                    return Err(Failure::new(
                        ErrorCode::BodyTooLarge,
                        "Binary input exceeds its declared size",
                    ));
                }
                return Ok(Some(data.to_vec()));
            }
        }
        if self.received != self.length {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Binary input ended before its declared size",
            ));
        }
        Ok(None)
    }
}
