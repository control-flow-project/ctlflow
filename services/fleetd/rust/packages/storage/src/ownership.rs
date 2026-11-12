use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn directory(state: &Path) -> Result<PathBuf> {
    let text = state.to_str().ok_or_else(|| {
        Failure::new(
            ErrorCode::Invalid,
            "Native state requires an exact UTF-8 path",
        )
    })?;
    if !fleetd_contracts::configuration::absolute_path(text) || text.contains('\0') {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Native state requires an exact absolute path",
        ));
    }
    let key = format!("{:x}", Sha256::digest(text.as_bytes()));
    let path = crate::authentication::root()?
        .join("ctlflow/native-ownership")
        .join(key);
    Ok(path)
}
