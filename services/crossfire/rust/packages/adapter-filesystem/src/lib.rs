use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
pub mod absolute_state;
pub mod agent_projects;
pub mod assets;
pub mod local_state;
pub mod lock;
pub mod logging;
pub mod managed_links;
pub mod owned;
pub mod publication;
pub mod release;
pub mod socket;
use rustix::fs::{AtFlags, Mode, OFlags};
use std::{
    fs::File,
    io::{Read, Write},
    os::fd::OwnedFd,
    path::{Component, Path},
};

fn denied() -> Failure {
    Failure::new(
        ErrorCode::Forbidden,
        "Private state must use owned regular files and non-symlink directories",
    )
}

fn check_directory(descriptor: &OwnedFd, private: bool) -> Result<()> {
    let info = rustix::fs::fstat(descriptor).map_err(|_| denied())?;
    if rustix::fs::FileType::from_raw_mode(info.st_mode) != rustix::fs::FileType::Directory {
        return Err(denied());
    }
    if private && (info.st_uid != rustix::process::getuid().as_raw() || info.st_mode & 0o077 != 0) {
        return Err(denied());
    }
    Ok(())
}

fn check_file(descriptor: &OwnedFd) -> Result<u64> {
    let info = rustix::fs::fstat(descriptor).map_err(|_| denied())?;
    if rustix::fs::FileType::from_raw_mode(info.st_mode) != rustix::fs::FileType::RegularFile
        || info.st_uid != rustix::process::getuid().as_raw()
        || info.st_mode & 0o077 != 0
        || info.st_nlink != 1
    {
        return Err(denied());
    }
    u64::try_from(info.st_size).map_err(|_| denied())
}

pub struct PrivateDirectory {
    descriptor: OwnedFd,
}

impl PrivateDirectory {
    pub fn child_optional(&self, name: &str, create: bool) -> Result<Option<Self>> {
        Self::leaf(name)?;
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let opened = match rustix::fs::openat(&self.descriptor, name, flags, Mode::empty()) {
            Ok(opened) => opened,
            Err(rustix::io::Errno::NOENT) if create => {
                match rustix::fs::mkdirat(&self.descriptor, name, Mode::from_raw_mode(0o700)) {
                    Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                    Err(_) => return Err(denied()),
                }
                self.sync()?;
                rustix::fs::openat(&self.descriptor, name, flags, Mode::empty())
                    .map_err(|_| denied())?
            }
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(denied()),
        };
        check_directory(&opened, true)?;
        Ok(Some(Self { descriptor: opened }))
    }
    pub fn child(&self, name: &str, create: bool) -> Result<Self> {
        self.child_optional(name, create)?.ok_or_else(denied)
    }
    pub fn sync(&self) -> Result<()> {
        rustix::fs::fsync(&self.descriptor).map_err(|_| denied())
    }
    pub fn remove_empty_directory(&self, name: &str) -> Result<()> {
        self.child(name, false)?;
        rustix::fs::unlinkat(&self.descriptor, name, AtFlags::REMOVEDIR).map_err(|_| denied())?;
        self.sync()
    }
    pub fn publish_file(&self, source: &str, target: &str) -> Result<()> {
        Self::leaf(source)?;
        Self::leaf(target)?;
        self.open_private(source, false)?;
        rustix::fs::renameat_with(
            &self.descriptor,
            source,
            &self.descriptor,
            target,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(|_| {
            Failure::new(
                ErrorCode::Conflict,
                "A published private file cannot replace another owner",
            )
        })?;
        self.sync()
    }
    pub fn replace_file(&self, source: &str, target: &str) -> Result<()> {
        Self::leaf(source)?;
        Self::leaf(target)?;
        self.open_private(source, false)?;
        match rustix::fs::openat(
            &self.descriptor,
            target,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(descriptor) => {
                check_file(&descriptor)?;
            }
            Err(rustix::io::Errno::NOENT) => {}
            Err(_) => return Err(denied()),
        }
        rustix::fs::renameat(&self.descriptor, source, &self.descriptor, target)
            .map_err(|_| denied())?;
        self.sync()
    }
    pub fn names(&self, maximum: usize) -> Result<Vec<String>> {
        let entries = rustix::fs::Dir::read_from(&self.descriptor).map_err(|_| denied())?;
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| denied())?;
            let name = entry.file_name().to_str().map_err(|_| denied())?;
            if [".", ".."].contains(&name) {
                continue;
            }
            if names.len() >= maximum {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Private directory inventory exceeds its bound",
                ));
            }
            names.push(name.to_owned());
        }
        names.sort_unstable();
        Ok(names)
    }

    pub fn move_entry(&self, name: &str, target: &Self) -> Result<()> {
        Self::leaf(name)?;
        let descriptor = rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| denied())?;
        let metadata = rustix::fs::fstat(&descriptor).map_err(|_| denied())?;
        match rustix::fs::FileType::from_raw_mode(metadata.st_mode) {
            rustix::fs::FileType::Directory => check_directory(&descriptor, true)?,
            rustix::fs::FileType::RegularFile => {
                check_file(&descriptor)?;
            }
            _ => return Err(denied()),
        }
        rustix::fs::renameat_with(
            &self.descriptor,
            name,
            &target.descriptor,
            name,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(|_| {
            Failure::new(
                ErrorCode::Conflict,
                "Private archive conflicts with active state; no file was overwritten",
            )
        })?;
        rustix::fs::fsync(&self.descriptor).map_err(|_| denied())?;
        rustix::fs::fsync(&target.descriptor).map_err(|_| denied())
    }

    pub fn open(path: &Path, create: bool) -> Result<Self> {
        Self::open_directory(path, create, true)
    }
    pub(crate) fn open_configuration(path: &Path) -> Result<Self> {
        let directory = Self::open_directory(path, false, false)?;
        let info = rustix::fs::fstat(&directory.descriptor).map_err(|_| denied())?;
        if info.st_uid != rustix::process::getuid().as_raw() || info.st_mode & 0o022 != 0 {
            return Err(denied());
        }
        Ok(directory)
    }
    fn open_directory(path: &Path, create: bool, private_root: bool) -> Result<Self> {
        if !path.is_absolute()
            || path
                .components()
                .collect::<std::path::PathBuf>()
                .as_os_str()
                != path.as_os_str()
        {
            return Err(denied());
        }
        let mut current = rustix::fs::open(
            "/",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| denied())?;
        let components: Vec<_> = path
            .components()
            .filter(|part| !matches!(part, Component::RootDir))
            .collect();
        if components.is_empty() {
            return Err(denied());
        }
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(part) = component else {
                return Err(denied());
            };
            let private = private_root && index + 1 == components.len();
            let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
            let opened = match rustix::fs::openat(&current, *part, flags, Mode::empty()) {
                Ok(opened) => opened,
                Err(rustix::io::Errno::NOENT) if create => {
                    match rustix::fs::mkdirat(&current, *part, Mode::from_raw_mode(0o700)) {
                        Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                        Err(_) => return Err(denied()),
                    }
                    rustix::fs::openat(&current, *part, flags, Mode::empty())
                        .map_err(|_| denied())?
                }
                Err(_) => return Err(denied()),
            };
            check_directory(&opened, private)?;
            current = opened;
        }
        Ok(Self {
            descriptor: current,
        })
    }

    fn leaf(name: &str) -> Result<()> {
        if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
            Err(denied())
        } else {
            Ok(())
        }
    }
    pub fn publish_directory(&self, source: &str, target: &str) -> Result<()> {
        self.child(source, false)?;
        Self::leaf(target)?;
        rustix::fs::renameat_with(
            &self.descriptor,
            source,
            &self.descriptor,
            target,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(|_| {
            Failure::new(
                ErrorCode::Conflict,
                "Private directory publication conflicts with an existing identity",
            )
        })?;
        self.sync()
    }

    pub fn prepared_database(&self, name: &str) -> Result<()> {
        Self::leaf(name)?;
        let opened = rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::RDWR | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| denied())?;
        check_file(&opened)?;
        Ok(())
    }

    pub fn socket(&self, name: &str) -> Result<()> {
        Self::leaf(name)?;
        let info = rustix::fs::statat(&self.descriptor, name, AtFlags::SYMLINK_NOFOLLOW).map_err(
            |error| match error {
                rustix::io::Errno::NOENT => {
                    Failure::new(ErrorCode::Unavailable, "Private socket is not available")
                }
                _ => denied(),
            },
        )?;
        if rustix::fs::FileType::from_raw_mode(info.st_mode) != rustix::fs::FileType::Socket
            || info.st_uid != rustix::process::getuid().as_raw()
            || info.st_mode & 0o077 != 0
        {
            return Err(denied());
        }
        Ok(())
    }

    pub fn read(&self, name: &str, maximum: u64) -> Result<Vec<u8>> {
        self.read_optional(name, maximum)?.ok_or_else(denied)
    }

    pub fn read_optional(&self, name: &str, maximum: u64) -> Result<Option<Vec<u8>>> {
        Self::leaf(name)?;
        let opened = match rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(opened) => opened,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(denied()),
        };
        let size = check_file(&opened)?;
        if size > maximum {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Private file exceeds its read limit",
            ));
        }
        let mut file = File::from(opened);
        let mut contents = Vec::with_capacity(usize::try_from(size).map_err(|_| denied())?);
        Read::by_ref(&mut file)
            .take(maximum.saturating_add(1))
            .read_to_end(&mut contents)
            .map_err(|_| denied())?;
        if contents.len() as u64 != size {
            return Err(denied());
        }
        Ok(Some(contents))
    }

    pub fn open_private(&self, name: &str, create: bool) -> Result<File> {
        Self::leaf(name)?;
        let flags = OFlags::RDWR
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::CLOEXEC
            | if create {
                OFlags::CREATE
            } else {
                OFlags::empty()
            };
        let opened = rustix::fs::openat(&self.descriptor, name, flags, Mode::from_raw_mode(0o600))
            .map_err(|_| denied())?;
        check_file(&opened)?;
        Ok(File::from(opened))
    }

    pub fn append(&self, name: &str) -> Result<File> {
        Self::leaf(name)?;
        let flags = OFlags::WRONLY
            | OFlags::CREATE
            | OFlags::APPEND
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::CLOEXEC;
        let opened = rustix::fs::openat(&self.descriptor, name, flags, Mode::from_raw_mode(0o600))
            .map_err(|_| denied())?;
        check_file(&opened)?;
        Ok(File::from(opened))
    }
    pub fn remove(&self, name: &str) -> Result<()> {
        Self::leaf(name)?;
        self.open_private(name, false)?;
        rustix::fs::unlinkat(&self.descriptor, name, AtFlags::empty()).map_err(|_| denied())?;
        rustix::fs::fsync(&self.descriptor).map_err(|_| denied())
    }

    pub fn remove_optional(&self, name: &str) -> Result<()> {
        Self::leaf(name)?;
        let descriptor = match rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(descriptor) => descriptor,
            Err(rustix::io::Errno::NOENT) => return Ok(()),
            Err(_) => return Err(denied()),
        };
        check_file(&descriptor)?;
        rustix::fs::unlinkat(&self.descriptor, name, AtFlags::empty()).map_err(|_| denied())?;
        self.sync()
    }
    pub fn private_file_size(&self, name: &str) -> Result<Option<u64>> {
        Self::leaf(name)?;
        let descriptor = match rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(descriptor) => descriptor,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(denied()),
        };
        check_file(&descriptor)?;
        let metadata = rustix::fs::fstat(&descriptor).map_err(|_| denied())?;
        u64::try_from(metadata.st_size)
            .map(Some)
            .map_err(|_| denied())
    }

    pub fn write_atomic(&self, name: &str, contents: &[u8]) -> Result<()> {
        Self::leaf(name)?;
        let temporary = format!(".pending-{}", identity::id());
        let opened = rustix::fs::openat(
            &self.descriptor,
            &temporary,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| denied())?;
        let result = (|| {
            let mut file = File::from(opened);
            file.write_all(contents).map_err(|_| denied())?;
            file.sync_all().map_err(|_| denied())?;
            rustix::fs::renameat(&self.descriptor, &temporary, &self.descriptor, name)
                .map_err(|_| denied())?;
            rustix::fs::fsync(&self.descriptor).map_err(|_| denied())?;
            Ok(())
        })();
        if result.is_err() {
            let _cleanup = rustix::fs::unlinkat(&self.descriptor, &temporary, AtFlags::empty());
        }
        result
    }

    pub fn write_new(&self, name: &str, contents: &[u8]) -> Result<()> {
        Self::leaf(name)?;
        let opened = rustix::fs::openat(
            &self.descriptor,
            name,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| denied())?;
        let result = (|| {
            let mut file = File::from(opened);
            file.write_all(contents).map_err(|_| denied())?;
            file.sync_all().map_err(|_| denied())?;
            rustix::fs::fsync(&self.descriptor).map_err(|_| denied())?;
            Ok(())
        })();
        if result.is_err() {
            let _removed = rustix::fs::unlinkat(&self.descriptor, name, AtFlags::empty());
        }
        result
    }
}
