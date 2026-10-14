mod deliveries;
mod rows;
mod rules;

use crossfire_kernel::{Failure, Result, failure::ErrorCode};

fn affected(count: usize) -> Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(Failure::new(ErrorCode::Missing, "Wake-up record not found"))
    }
}
