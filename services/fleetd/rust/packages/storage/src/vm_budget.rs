use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn directory(fleet: &Path) -> Result<PathBuf> {
    let text = fleet
        .to_str()
        .filter(|value| fleetd_contracts::configuration::absolute_path(value))
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "VM budget requires an exact fleet directory",
            )
        })?;
    Ok(crate::authentication::root()?
        .join("ctlflow/vm-budgets")
        .join(format!("{:x}", Sha256::digest(text.as_bytes()))))
}
