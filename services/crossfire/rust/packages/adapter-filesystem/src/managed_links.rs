use crate::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use rustix::fs::{AtFlags, FileType};
use std::path::{Component, Path};

fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Forbidden,
        "Managed project link must be an owned symbolic link to a normalized relative installation",
    )
}
fn target(value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > 4096
        || path.is_absolute()
        || path.as_os_str()
            != path
                .components()
                .collect::<std::path::PathBuf>()
                .as_os_str()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid());
    }
    Ok(())
}
impl PrivateDirectory {
    pub fn managed_link(&self, name: &str) -> Result<Option<String>> {
        Self::leaf(name)?;
        let info = match rustix::fs::statat(&self.descriptor, name, AtFlags::SYMLINK_NOFOLLOW) {
            Ok(info) => info,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(invalid()),
        };
        if FileType::from_raw_mode(info.st_mode) != FileType::Symlink
            || info.st_uid != rustix::process::getuid().as_raw()
            || info.st_nlink != 1
        {
            return Err(invalid());
        }
        let value =
            rustix::fs::readlinkat(&self.descriptor, name, Vec::new()).map_err(|_| invalid())?;
        let value = value.to_str().map_err(|_| invalid())?.to_owned();
        target(&value)?;
        let current = rustix::fs::statat(&self.descriptor, name, AtFlags::SYMLINK_NOFOLLOW)
            .map_err(|_| invalid())?;
        if current.st_dev != info.st_dev || current.st_ino != info.st_ino {
            return Err(invalid());
        }
        Ok(Some(value))
    }
    pub fn replace_managed_link(&self, name: &str, value: &str) -> Result<()> {
        Self::leaf(name)?;
        target(value)?;
        self.managed_link(name)?;
        let temporary = format!(".pending-{}", identity::id());
        rustix::fs::symlinkat(value, &self.descriptor, &temporary).map_err(|_| invalid())?;
        let result = (|| {
            rustix::fs::renameat(&self.descriptor, &temporary, &self.descriptor, name)
                .map_err(|_| invalid())?;
            self.sync()?;
            if self.managed_link(name)?.as_deref() != Some(value) {
                return Err(invalid());
            }
            Ok(())
        })();
        if result.is_err() {
            let _cleanup = rustix::fs::unlinkat(&self.descriptor, &temporary, AtFlags::empty());
        }
        result
    }
}
