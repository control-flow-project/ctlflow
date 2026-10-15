use crate::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    os::fd::AsRawFd,
    path::{Path, PathBuf},
};

pub struct Socket {
    directory: PrivateDirectory,
    name: String,
}
impl Socket {
    pub fn open(path: &Path) -> Result<Self> {
        let socket = Self::prepare(path)?;
        socket.validate()?;
        Ok(socket)
    }
    pub fn prepare(path: &Path) -> Result<Self> {
        let directory = PrivateDirectory::open(
            path.parent().ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Private socket requires an exact parent directory",
                )
            })?,
            false,
        )?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Private socket name is not valid Unicode",
                )
            })?
            .to_owned();
        PrivateDirectory::leaf(&name)?;
        Ok(Self { directory, name })
    }
    pub fn protect(&self) -> Result<()> {
        let forbidden = || {
            Failure::new(
                ErrorCode::Forbidden,
                "Private socket must be an owned native socket without symbolic links",
            )
        };
        let descriptor = rustix::fs::openat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::OFlags::PATH | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| forbidden())?;
        let info = rustix::fs::fstat(&descriptor).map_err(|_| forbidden())?;
        if rustix::fs::FileType::from_raw_mode(info.st_mode) != rustix::fs::FileType::Socket
            || info.st_uid != rustix::process::getuid().as_raw()
        {
            return Err(forbidden());
        }
        let held = format!("/proc/self/fd/{}", descriptor.as_raw_fd());
        rustix::fs::chmod(&held, rustix::fs::Mode::from_raw_mode(0o600))
            .map_err(|_| forbidden())?;
        let current = rustix::fs::statat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
        )
        .map_err(|_| forbidden())?;
        if current.st_dev != info.st_dev || current.st_ino != info.st_ino {
            return Err(forbidden());
        }
        self.validate()
    }
    pub fn validate(&self) -> Result<()> {
        self.directory.socket(&self.name)
    }
    pub fn endpoint(&self) -> PathBuf {
        PathBuf::from(format!(
            "/proc/self/fd/{}/{}",
            self.directory.descriptor.as_raw_fd(),
            self.name
        ))
    }
}
