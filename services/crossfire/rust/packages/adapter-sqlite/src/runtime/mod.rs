mod decisions;
mod incidents;
mod observations;
mod summaries;

use crossfire_kernel::{Failure, Result, failure::ErrorCode};

fn stored_code<T>(value: Result<T>) -> Result<T> {
    value.map_err(|_| {
        Failure::new(
            ErrorCode::Unavailable,
            "Stored runtime discriminant is invalid",
        )
    })
}

fn boolean(value: i64) -> Result<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Failure::new(
            ErrorCode::Unavailable,
            "Stored runtime boolean is invalid",
        )),
    }
}
