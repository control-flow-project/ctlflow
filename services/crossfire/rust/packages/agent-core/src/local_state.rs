use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Serialize, de::DeserializeOwned};

pub trait LocalState: Send + Sync {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>>;
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()>;
    fn remove(&self, file: &str) -> Result<()>;
}
impl<S: LocalState> LocalState for std::sync::Arc<S> {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
        self.as_ref().read(file, maximum)
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        self.as_ref().write(file, bytes, maximum)
    }
    fn remove(&self, file: &str) -> Result<()> {
        self.as_ref().remove(file)
    }
}
pub fn read<T: DeserializeOwned>(
    storage: &impl LocalState,
    file: &str,
    maximum: usize,
) -> Result<Option<T>> {
    storage
        .read(file, maximum)?
        .map(|bytes| {
            serde_json::from_slice(&bytes)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid retained listener state"))
        })
        .transpose()
}
pub fn write<T: Serialize>(
    storage: &impl LocalState,
    file: &str,
    value: &T,
    maximum: usize,
) -> Result<()> {
    let mut encoded = crossfire_kernel::bytes::Buffer::new(maximum);
    serde_json::to_writer(&mut encoded, value).map_err(|error| {
        Failure::new(
            if error.io_error_kind() == Some(std::io::ErrorKind::FileTooLarge) {
                ErrorCode::Limit
            } else {
                ErrorCode::Invalid
            },
            "Listener state cannot be encoded within its declared byte bound",
        )
    })?;
    storage.write(file, &encoded.into_vec(), maximum)
}
pub fn encoded_bytes<T: Serialize>(value: &T) -> Result<usize> {
    let mut count = crossfire_kernel::bytes::Count::default();
    serde_json::to_writer(&mut count, value)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Listener byte accounting failed"))?;
    Ok(count.0)
}
