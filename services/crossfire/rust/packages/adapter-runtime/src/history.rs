use crossfire_adapter_filesystem::owned::OwnedFile;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

const MAX_INTERVAL: usize = 8 * 1024 * 1024;
const READ_CHUNK: usize = 64 * 1024;
const MAX_RECORD: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Boundary {
    pub key: String,
    pub position: u64,
    pub prefix: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Inspection {
    pub bytes_read: u64,
    pub records: u64,
    pub maximum_buffered_bytes: usize,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn prefix(file: &OwnedFile, position: u64) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(file.read_at(position.min(256) as usize, 0)?)
    ))
}

pub fn header(path: &Path) -> Result<Option<Value>> {
    let Some(file) = OwnedFile::open(path, u64::MAX)? else {
        return Ok(None);
    };
    let information = file.information()?;
    let mut length = information.size.min(4096) as usize;
    while length > 0 {
        let bytes = file.read_at(length, 0)?;
        if let Some(end) = bytes.iter().position(|character| *character == b'\n') {
            return serde_json::from_slice(&bytes[..end])
                .map(Some)
                .map_err(|_| invalid("Invalid native history header"));
        }
        if length as u64 == information.size {
            return Ok(None);
        }
        if length == MAX_INTERVAL {
            return Err(invalid(
                "Native history header exceeds its verification bound",
            ));
        }
        length = (length * 2)
            .min(MAX_INTERVAL)
            .min(information.size as usize);
    }
    Ok(None)
}

pub fn capture(path: &Path) -> Result<Option<Boundary>> {
    let Some(file) = OwnedFile::open(path, u64::MAX)? else {
        return Ok(None);
    };
    let information = file.information()?;
    let mut position = information.size;
    if position > 0 && file.read_at(1, position - 1)? != b"\n" {
        let start = position.saturating_sub(MAX_INTERVAL as u64);
        let bytes = file.read_at((position - start) as usize, start)?;
        match bytes.iter().rposition(|character| *character == b'\n') {
            Some(end) => position = start + end as u64 + 1,
            None if start == 0 => position = 0,
            None => {
                return Err(invalid(
                    "Partial native history record exceeds its verification bound",
                ));
            }
        }
    }
    Ok(Some(Boundary {
        key: information.key,
        position,
        prefix: prefix(&file, position)?,
    }))
}

pub fn since(
    path: &Path,
    boundary: Option<&Boundary>,
    mut inspect: impl FnMut(Value) -> Result<()>,
) -> Result<Inspection> {
    let Some(file) = OwnedFile::open(path, u64::MAX)? else {
        return if boundary.is_none() {
            Ok(Inspection::default())
        } else {
            Err(invalid("Native history lost its publication boundary"))
        };
    };
    let information = file.information()?;
    if let Some(boundary) = boundary
        && (information.key != boundary.key
            || information.size < boundary.position
            || prefix(&file, boundary.position)? != boundary.prefix)
    {
        return Err(invalid("Native history lost its publication boundary"));
    }
    let mut result = Inspection::default();
    let mut position = boundary.map_or(0, |value| value.position);
    let mut record = Vec::new();
    while position < information.size {
        let chunk = file.read_at(
            (information.size - position).min(READ_CHUNK as u64) as usize,
            position,
        )?;
        position += chunk.len() as u64;
        result.bytes_read += chunk.len() as u64;
        for segment in chunk.split_inclusive(|character| *character == b'\n') {
            let ended = segment.last() == Some(&b'\n');
            let content = if ended {
                &segment[..segment.len() - 1]
            } else {
                segment
            };
            if record.len() + content.len() > MAX_RECORD {
                return Err(invalid(
                    "Native history record exceeds its verification bound",
                ));
            }
            record.extend_from_slice(content);
            result.maximum_buffered_bytes = result
                .maximum_buffered_bytes
                .max(record.capacity() + chunk.len());
            if ended {
                if !record.is_empty() {
                    inspect(
                        serde_json::from_slice(&record)
                            .map_err(|_| invalid("Invalid native history record"))?,
                    )?;
                    result.records += 1;
                }
                record.clear();
            }
        }
    }
    let changed = match boundary {
        Some(value) => prefix(&file, value.position)? != value.prefix,
        None => false,
    };
    if file.information()?.size < information.size || changed {
        return Err(invalid(
            "Native history changed during receipt verification",
        ));
    }
    Ok(result)
}
