use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub fn prepare(state: &Path) -> Result<PathBuf> {
    PrivateDirectory::open(state, false)?;
    let path = state.join(".pi");
    PrivateDirectory::open(&path, true)?;
    Ok(path)
}
pub fn refresh(home: &Path, source: &Path) -> Result<()> {
    let invalid = || {
        Failure::new(
            ErrorCode::Unauthorized,
            "Cannot refresh the private Pi auth/models configuration. Configure it on the host, never in chat",
        )
    };
    if !source.is_absolute()
        || std::fs::canonicalize(source).is_ok_and(|source| source.as_os_str() == home.as_os_str())
    {
        return Err(invalid());
    }
    let directory = PrivateDirectory::open(home, false)?;
    for name in ["auth.json", "models.json"] {
        let path = source.join(name);
        if let Some(file) = OwnedFile::open(&path, 1024 * 1024)? {
            file.private_permissions()?;
            let information = file.information()?;
            let bytes = Zeroizing::new(file.read_at(information.size as usize, 0)?);
            if !serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| invalid())?
                .is_object()
                || information != file.information()?
            {
                return Err(invalid());
            }
            directory.write_atomic(name, &bytes)?;
        } else if let Some(existing) = directory.read_optional(name, 1024 * 1024)? {
            drop(Zeroizing::new(existing));
            directory.remove(name)?;
        }
    }
    Ok(())
}
