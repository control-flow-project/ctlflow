use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use rustix::fs::{FileType, Mode, OFlags};
use std::{
    fs::{File, Metadata},
    os::{
        fd::OwnedFd,
        unix::fs::{FileExt, MetadataExt},
    },
    path::{Component, Path},
};

pub struct Directory(OwnedFd);
pub struct Asset(File);
fn failed() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Public assets require bounded regular files inside a non-symlink asset directory",
    )
}
fn flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}
impl Directory {
    pub fn open(path: &Path) -> Result<Self> {
        if !path.is_absolute() {
            return Err(failed());
        }
        let mut parent = rustix::fs::open("/", flags(), Mode::empty()).map_err(|_| failed())?;
        for part in path.components() {
            match part {
                Component::RootDir => {}
                Component::Normal(part) => {
                    parent = rustix::fs::openat(&parent, part, flags(), Mode::empty())
                        .map_err(|_| failed())?;
                }
                _ => return Err(failed()),
            }
        }
        Ok(Self(parent))
    }
    pub fn file(&self, name: &str, maximum: u64) -> Result<Option<Asset>> {
        if name.is_empty() || name.len() > 4096 || maximum == 0 || name.contains(['\\', '\0']) {
            return Err(failed());
        }
        let parts = name.split('/').collect::<Vec<_>>();
        if parts.iter().any(|part| {
            part.is_empty() || part.starts_with('.') || part.chars().any(char::is_control)
        }) {
            return Err(failed());
        }
        let (leaf, parents) = parts.split_last().ok_or_else(failed)?;
        let mut current = rustix::io::fcntl_dupfd_cloexec(&self.0, 0).map_err(|_| failed())?;
        for parent in parents {
            current = match rustix::fs::openat(&current, *parent, flags(), Mode::empty()) {
                Ok(value) => value,
                Err(rustix::io::Errno::NOENT) => return Ok(None),
                Err(_) => return Err(failed()),
            };
        }
        let opened = match rustix::fs::openat(
            &current,
            *leaf,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(value) => value,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(failed()),
        };
        let info = rustix::fs::fstat(&opened).map_err(|_| failed())?;
        if FileType::from_raw_mode(info.st_mode) != FileType::RegularFile
            || u64::try_from(info.st_size).map_err(|_| failed())? > maximum
        {
            return Err(failed());
        }
        Ok(Some(Asset(File::from(opened))))
    }
}
impl Asset {
    pub fn metadata(&self) -> Result<Metadata> {
        self.0.metadata().map_err(|_| failed())
    }
    pub fn read(&self, maximum: usize) -> Result<Vec<u8>> {
        let before = self.metadata()?;
        if before.len() > maximum as u64 {
            return Err(failed());
        }
        let mut bytes = vec![0; before.len() as usize];
        self.0.read_exact_at(&mut bytes, 0).map_err(|_| failed())?;
        let after = self.metadata()?;
        if before.len() != after.len()
            || before.mtime() != after.mtime()
            || before.mtime_nsec() != after.mtime_nsec()
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
        {
            return Err(failed());
        }
        Ok(bytes)
    }
    pub fn into_file(self) -> File {
        self.0
    }
}
