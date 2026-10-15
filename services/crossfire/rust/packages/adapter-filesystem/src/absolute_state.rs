use crate::{PrivateDirectory, owned::OwnedFile};
use crossfire_agent_core::local_state::LocalState;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::Path;

pub struct AbsoluteState;
fn location(file: &str, create: bool) -> Result<(PrivateDirectory, &str)> {
    let path = Path::new(file);
    if !path.is_absolute() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "This private filesystem port requires an absolute owned file path",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Private file has no parent directory"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Private file path is not UTF-8"))?;
    Ok((PrivateDirectory::open(parent, create)?, name))
}
impl LocalState for AbsoluteState {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
        if OwnedFile::open(Path::new(file), maximum as u64)?.is_none() {
            return Ok(None);
        }
        let (directory, name) = location(file, false)?;
        directory.read_optional(name, maximum as u64)
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        if bytes.len() > maximum {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Private state exceeds its declared file limit",
            ));
        }
        let (directory, name) = location(file, true)?;
        if directory
            .private_file_size(name)?
            .is_some_and(|size| size > maximum as u64)
        {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Existing private state exceeds its declared file limit",
            ));
        }
        directory.write_atomic(name, bytes)
    }
    fn remove(&self, file: &str) -> Result<()> {
        if OwnedFile::open(Path::new(file), u64::MAX)?.is_none() {
            return Ok(());
        }
        let (directory, name) = location(file, false)?;
        directory.remove_optional(name)
    }
}
