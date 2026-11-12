use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::Path;

fn absolute(path: &Path) -> bool {
    path.to_str().is_some_and(|text| {
        text.starts_with('/')
            && !text.contains(['\\', '\0'])
            && (text == "/"
                || text
                    .split('/')
                    .skip(1)
                    .all(|part| !part.is_empty() && part != "." && part != ".."))
    })
}

// This directory stays in the host kernel, outside all exported guest trees.
pub fn prepare(directory: &Path, workspace: &Path, home: &Path) -> Result<()> {
    if !absolute(directory) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Native ownership requires an exact absolute host directory",
        ));
    }
    for exported in [workspace, home] {
        if !absolute(exported) || directory.starts_with(exported) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Native ownership must remain outside the workspace and native home",
            ));
        }
    }
    PrivateDirectory::open(directory, true)?;
    Ok(())
}

pub fn acquire(directory: &Path, workspace: &Path, home: &Path) -> Result<StateLock> {
    prepare(directory, workspace, home)?;
    let ownership = StateLock::acquire(&directory.join("owner"))?;
    crate::execution_state::require_quiescent(directory)?;
    Ok(ownership)
}
