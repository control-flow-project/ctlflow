use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use rustix::fs::{FileType, Mode, OFlags};
use std::{
    fs::File,
    os::unix::{fs::FileExt, fs::MetadataExt},
    path::{Component, Path},
};

fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Native evidence requires an exact bounded owned regular file without symbolic links",
    )
}

pub struct OwnedFile(File);

pub fn write_configuration(path: &Path, bytes: &[u8], maximum: usize) -> Result<()> {
    if bytes.len() > maximum {
        return Err(Failure::new(
            ErrorCode::BodyTooLarge,
            "Configuration exceeds its declared file limit",
        ));
    }
    let parent = path.parent().ok_or_else(invalid)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid)?;
    if let Some(file) = OwnedFile::open(path, maximum as u64)? {
        file.configuration_permissions()?;
    }
    crate::PrivateDirectory::open_configuration(parent)?.write_atomic(name, bytes)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Information {
    pub key: String,
    pub size: u64,
}

impl OwnedFile {
    pub fn into_file(self) -> File {
        self.0
    }
    pub fn configuration(&self, maximum: usize) -> Result<Vec<u8>> {
        self.configuration_permissions()?;
        let before = self.0.metadata().map_err(|_| invalid())?;
        if before.len() > maximum as u64 {
            return Err(invalid());
        }
        let bytes = self.read_at(before.len() as usize, 0)?;
        let after = self.0.metadata().map_err(|_| invalid())?;
        if before.len() != after.len()
            || before.mtime() != after.mtime()
            || before.mtime_nsec() != after.mtime_nsec()
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
        {
            return Err(invalid());
        }
        Ok(bytes)
    }
    pub fn open(path: &Path, maximum: u64) -> Result<Option<Self>> {
        if !path.is_absolute()
            || maximum == 0
            || path
                .components()
                .collect::<std::path::PathBuf>()
                .as_os_str()
                != path.as_os_str()
        {
            return Err(invalid());
        }
        let mut parent = rustix::fs::open(
            "/",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| invalid())?;
        let mut components = path
            .components()
            .filter(|component| !matches!(component, Component::RootDir))
            .peekable();
        while let Some(component) = components.next() {
            let Component::Normal(name) = component else {
                return Err(invalid());
            };
            if components.peek().is_none() {
                let descriptor = match rustix::fs::openat(
                    &parent,
                    name,
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                    Mode::empty(),
                ) {
                    Ok(value) => value,
                    Err(rustix::io::Errno::NOENT) => return Ok(None),
                    Err(_) => return Err(invalid()),
                };
                let metadata = rustix::fs::fstat(&descriptor).map_err(|_| invalid())?;
                if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile
                    || metadata.st_uid != rustix::process::getuid().as_raw()
                    || metadata.st_mode & 0o002 != 0
                    || u64::try_from(metadata.st_size).map_err(|_| invalid())? > maximum
                {
                    return Err(invalid());
                }
                return Ok(Some(Self(File::from(descriptor))));
            }
            parent = match rustix::fs::openat(
                &parent,
                name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ) {
                Ok(value) => value,
                Err(rustix::io::Errno::NOENT) => return Ok(None),
                Err(_) => return Err(invalid()),
            };
        }
        Err(invalid())
    }

    pub fn information(&self) -> Result<Information> {
        let metadata = self.0.metadata().map_err(|_| invalid())?;
        Ok(Information {
            key: format!("{}:{}", metadata.dev(), metadata.ino()),
            size: metadata.len(),
        })
    }

    pub fn configuration_permissions(&self) -> Result<()> {
        if self.0.metadata().map_err(|_| invalid())?.mode() & 0o022 != 0 {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn read_at(&self, length: usize, position: u64) -> Result<Vec<u8>> {
        let mut output = vec![0; length];
        self.0.read_exact_at(&mut output, position).map_err(|_| {
            Failure::new(
                ErrorCode::Invalid,
                "Native evidence changed during its bounded read",
            )
        })?;
        Ok(output)
    }

    pub fn private_permissions(&self) -> Result<()> {
        let metadata = self.0.metadata().map_err(|_| invalid())?;
        if metadata.mode() & 0o077 != 0 || metadata.nlink() != 1 {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn secure_and_sync(&self) -> Result<()> {
        let metadata = self.0.metadata().map_err(|_| invalid())?;
        if metadata.nlink() != 1 || metadata.mode() & 0o022 != 0 {
            return Err(invalid());
        }
        rustix::fs::fchmod(&self.0, Mode::from_raw_mode(0o600)).map_err(|_| invalid())?;
        self.0.sync_all().map_err(|_| invalid())
    }
}

pub enum DirectoryAccess {
    Configuration,
    Workspace,
}
pub fn validate_directory(path: &Path, access: DirectoryAccess) -> Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .collect::<std::path::PathBuf>()
            .as_os_str()
            != path.as_os_str()
    {
        return Err(invalid());
    }
    let mut descriptor = rustix::fs::open(
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| invalid())?;
    let mut count = 0;
    for component in path
        .components()
        .filter(|component| !matches!(component, Component::RootDir))
    {
        let Component::Normal(name) = component else {
            return Err(invalid());
        };
        descriptor = rustix::fs::openat(
            &descriptor,
            name,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| invalid())?;
        count += 1;
    }
    let info = rustix::fs::fstat(&descriptor).map_err(|_| invalid())?;
    let mask = match access {
        DirectoryAccess::Configuration => 0o022,
        DirectoryAccess::Workspace => 0o002,
    };
    if count == 0 || info.st_uid != rustix::process::getuid().as_raw() || info.st_mode & mask != 0 {
        return Err(invalid());
    }
    Ok(())
}
