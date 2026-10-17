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
pub struct Ownership {
    socket: Socket,
    device: u64,
    inode: u64,
}
impl Ownership {
    pub fn remove(self) -> Result<()> {
        self.socket.remove_exact(self.device, self.inode)
    }
}
impl Drop for Ownership {
    fn drop(&mut self) {
        let _removed = self.socket.remove_exact(self.device, self.inode);
    }
}
impl Socket {
    fn information(&self) -> Result<rustix::fs::Stat> {
        self.validate()?;
        rustix::fs::statat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
        )
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Private socket identity is unavailable",
            )
        })
    }
    fn remove_exact(&self, device: u64, inode: u64) -> Result<()> {
        let info = match rustix::fs::statat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Ok(info) => info,
            Err(rustix::io::Errno::NOENT) => return Ok(()),
            Err(_) => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Cannot verify private socket retirement",
                ));
            }
        };
        if info.st_dev != device || info.st_ino != inode {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Private socket changed; replacement was not removed",
            ));
        }
        self.validate()?;
        rustix::fs::unlinkat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::AtFlags::empty(),
        )
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Cannot retire the exact owned socket",
            )
        })?;
        self.directory.sync()
    }
    pub async fn remove_stale(&self) -> Result<()> {
        match rustix::fs::statat(
            &self.directory.descriptor,
            &self.name,
            rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
        ) {
            Err(rustix::io::Errno::NOENT) => return Ok(()),
            Ok(_) => {}
            Err(_) => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Cannot inspect private controller socket",
                ));
            }
        }
        let before = self.information()?;
        match tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::UnixStream::connect(self.endpoint()),
        )
        .await
        {
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                self.remove_exact(before.st_dev, before.st_ino)
            }
            Ok(Ok(_)) => Err(Failure::new(
                ErrorCode::Conflict,
                "Controller is already running",
            )),
            _ => Err(Failure::new(
                ErrorCode::Unavailable,
                "Existing controller socket could not be proved inactive",
            )),
        }
    }
    pub fn claim(self) -> Result<Ownership> {
        let info = self.information()?;
        Ok(Ownership {
            socket: self,
            device: info.st_dev,
            inode: info.st_ino,
        })
    }
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
