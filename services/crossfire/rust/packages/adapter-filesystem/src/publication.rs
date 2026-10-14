use crate::{PrivateDirectory, lock::StateLock};
use crossfire_domain::publication::{
    port::{BinarySource, PublicationStore},
    values::{File, MAX_FILE_BYTES, MAX_FILES},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    os::unix::fs::MetadataExt,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

fn failed() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Report storage failed its private-file integrity or lifecycle check",
    )
}
fn valid_id(value: &str) -> Result<()> {
    if value.len() == 36
        && value.bytes().enumerate().all(|(index, value)| {
            if [8, 13, 18, 23].contains(&index) {
                value == b'-'
            } else {
                value.is_ascii_digit() || (b'a'..=b'f').contains(&value)
            }
        })
    {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid report storage identity",
        ))
    }
}
struct Inner {
    root: PrivateDirectory,
    _owner: Mutex<StateLock>,
    busy: Mutex<HashSet<String>>,
    closed: AtomicBool,
    cancellation: CancellationToken,
    uploads: Arc<tokio::sync::Semaphore>,
}
pub struct Store(Arc<Inner>);
pub struct Guard {
    state: Arc<Inner>,
    id: String,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut busy) = self.state.busy.lock() {
            busy.remove(&self.id);
        }
    }
}
struct Pending {
    directory: Arc<PrivateDirectory>,
    name: String,
    complete: bool,
}
impl Drop for Pending {
    fn drop(&mut self) {
        if !self.complete {
            let _cleanup = self.directory.remove(&self.name);
        }
    }
}
pub struct Reader {
    file: tokio::fs::File,
    bytes: i64,
    remaining: i64,
    initial: std::fs::Metadata,
    state: Arc<Inner>,
    complete: bool,
}
impl Store {
    pub fn open(directory: &Path, maximum_uploads: usize) -> Result<Self> {
        if !(1..=32).contains(&maximum_uploads) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid bounded report upload capacity",
            ));
        }
        let root = PrivateDirectory::open(directory, true)?;
        let owner = StateLock::acquire(&directory.join("owner"))?;
        Ok(Self(Arc::new(Inner {
            root,
            _owner: Mutex::new(owner),
            busy: Mutex::new(HashSet::new()),
            closed: AtomicBool::new(false),
            cancellation: CancellationToken::new(),
            uploads: Arc::new(tokio::sync::Semaphore::new(maximum_uploads)),
        })))
    }
    pub fn close(&self) {
        self.0.closed.store(true, Ordering::Release);
        self.0.cancellation.cancel();
        self.0.uploads.close();
    }
    fn available(&self) -> Result<()> {
        if self.0.closed.load(Ordering::Acquire) {
            Err(failed())
        } else {
            Ok(())
        }
    }
    fn directory(&self, id: &str, create: bool) -> Result<PrivateDirectory> {
        self.available()?;
        valid_id(id)?;
        self.0.root.child(id, create)
    }
    fn discard(directory: &PrivateDirectory) -> Result<()> {
        for name in directory.names(MAX_FILES + 1)? {
            if let Some(id) = name.strip_prefix(".pending-") {
                valid_id(id)?;
                directory.remove(&name)?;
            }
        }
        Ok(())
    }
}
impl Drop for Store {
    fn drop(&mut self) {
        self.close();
    }
}
impl PublicationStore for Store {
    type Guard = Guard;
    type Reader = Reader;
    fn exclusive(&self, id: &str) -> Result<Guard> {
        self.available()?;
        valid_id(id)?;
        let mut busy = self.0.busy.lock().map_err(|_| failed())?;
        if !busy.insert(id.to_owned()) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Another report operation is in progress; retry this exact operation",
            ));
        }
        Ok(Guard {
            state: Arc::clone(&self.0),
            id: id.to_owned(),
        })
    }
    async fn upload(&self, id: &str, file: &File, mut input: impl BinarySource) -> Result<()> {
        self.available()?;
        let _permit = Arc::clone(&self.0.uploads)
            .try_acquire_owned()
            .map_err(|_| {
                Failure::new(
                    ErrorCode::RateLimit,
                    "Report upload capacity is busy; retry this exact file",
                )
            })?;
        valid_id(&file.id)?;
        if file.publication_id != id
            || !(0..=MAX_FILE_BYTES).contains(&file.manifest.bytes)
            || input.length() != file.manifest.bytes
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Report upload does not match its declared file",
            ));
        }
        let directory = Arc::new(self.directory(id, true)?);
        Self::discard(&directory)?;
        let name = format!(".pending-{}", identity::id());
        directory.write_new(&name, &[])?;
        let mut pending = Pending {
            directory: Arc::clone(&directory),
            name,
            complete: false,
        };
        let mut handle = tokio::fs::File::from_std(directory.open_private(&pending.name, false)?);
        let mut digest = Sha256::new();
        let mut size = 0_i64;
        loop {
            let chunk = tokio::select! {
                biased; _ = self.0.cancellation.cancelled() => return Err(failed()),
                value = input.next() => value?,
            };
            let Some(chunk) = chunk else {
                break;
            };
            size = size
                .checked_add(i64::try_from(chunk.len()).map_err(|_| failed())?)
                .ok_or_else(failed)?;
            if size > file.manifest.bytes {
                return Err(Failure::new(
                    ErrorCode::BodyTooLarge,
                    "Report upload exceeds its declared size",
                ));
            }
            digest.update(&chunk);
            handle.write_all(&chunk).await.map_err(|_| failed())?;
        }
        if size != file.manifest.bytes || format!("{:x}", digest.finalize()) != file.manifest.sha256
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Report upload size or digest mismatch",
            ));
        }
        handle.sync_all().await.map_err(|_| failed())?;
        drop(handle);
        self.available()?;
        directory.replace_file(&pending.name, &file.id)?;
        pending.complete = true;
        Ok(())
    }
    async fn verify(&self, id: &str, files: &[File]) -> Result<()> {
        let directory = self.directory(id, false)?;
        if files.is_empty() || files.len() > MAX_FILES {
            return Err(failed());
        }
        Self::discard(&directory)?;
        for file in files {
            let mut reader = self.read(id, file)?;
            let mut digest = Sha256::new();
            while let Some(chunk) = reader.next().await? {
                digest.update(&chunk);
            }
            if format!("{:x}", digest.finalize()) != file.manifest.sha256 {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Report bytes no longer match the declared manifest",
                ));
            }
        }
        self.available()?;
        directory.sync()?;
        self.0.root.sync()
    }
    fn read(&self, id: &str, file: &File) -> Result<Reader> {
        valid_id(&file.id)?;
        if file.publication_id != id || !(0..=MAX_FILE_BYTES).contains(&file.manifest.bytes) {
            return Err(failed());
        }
        let handle = self.directory(id, false)?.open_private(&file.id, false)?;
        let initial = handle.metadata().map_err(|_| failed())?;
        if initial.len() != file.manifest.bytes as u64 {
            return Err(failed());
        }
        Ok(Reader {
            file: tokio::fs::File::from_std(handle),
            bytes: file.manifest.bytes,
            remaining: file.manifest.bytes,
            initial,
            state: Arc::clone(&self.0),
            complete: false,
        })
    }
    fn remove(&self, id: &str) -> Result<()> {
        self.available()?;
        valid_id(id)?;
        let Some(directory) = self.0.root.child_optional(id, false)? else {
            return self.0.root.sync();
        };
        let names = directory.names(MAX_FILES + 1)?;
        for name in &names {
            valid_id(name.strip_prefix(".pending-").unwrap_or(name))?;
            directory.open_private(name, false)?;
        }
        for name in names {
            directory.remove(&name)?;
        }
        self.0.root.remove_empty_directory(id)
    }
}
impl BinarySource for Reader {
    fn length(&self) -> i64 {
        self.bytes
    }
    async fn next(&mut self) -> Result<Option<Vec<u8>>> {
        if self.state.closed.load(Ordering::Acquire) {
            return Err(failed());
        }
        if self.complete {
            return Ok(None);
        }
        if self.remaining == 0 {
            let current = self.file.metadata().await.map_err(|_| failed())?;
            if current.len() != self.initial.len()
                || current.mtime() != self.initial.mtime()
                || current.mtime_nsec() != self.initial.mtime_nsec()
                || current.ctime() != self.initial.ctime()
                || current.ctime_nsec() != self.initial.ctime_nsec()
            {
                return Err(failed());
            }
            self.complete = true;
            return Ok(None);
        }
        let mut bytes = vec![0; self.remaining.min(65_536) as usize];
        let count = self.file.read(&mut bytes).await.map_err(|_| failed())?;
        if count == 0 {
            return Err(failed());
        }
        bytes.truncate(count);
        self.remaining -= count as i64;
        Ok(Some(bytes))
    }
}
