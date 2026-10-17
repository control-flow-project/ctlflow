use crate::PrivateDirectory;
use crossfire_domain::logging::{DAY_MS, Retention};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::iso_timestamp};
use serde_json::json;
use std::{
    fs::{File, Metadata},
    io::{BufRead, BufReader, Write},
    os::unix::fs::MetadataExt,
    path::Path,
    sync::Mutex,
};

const RECORD_BYTES: usize = 512 * 1024;
const MESSAGE_BYTES: usize = 64 * 1024;
#[derive(Default)]
struct State {
    closed: bool,
    write: Option<String>,
    cleanup: Option<String>,
    maintenance: Option<String>,
}
pub struct Store {
    directory: PrivateDirectory,
    days: i64,
    state: Mutex<State>,
}
fn failed() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Platform diagnostic storage is unavailable; inspect private logging storage",
    )
}
struct Pending<'a> {
    directory: &'a PrivateDirectory,
    name: String,
}
impl Drop for Pending<'_> {
    fn drop(&mut self) {
        let _cleanup = self.directory.remove(&self.name);
    }
}
fn same(before: &Metadata, after: &Metadata) -> bool {
    before.dev() == after.dev()
        && before.ino() == after.ino()
        && before.len() == after.len()
        && before.mtime() == after.mtime()
        && before.mtime_nsec() == after.mtime_nsec()
        && before.ctime() == after.ctime()
        && before.ctime_nsec() == after.ctime_nsec()
}
fn unchanged(
    directory: &PrivateDirectory,
    name: &str,
    input: &File,
    before: &Metadata,
) -> Result<()> {
    let current = directory
        .open_private(name, false)?
        .metadata()
        .map_err(|_| failed())?;
    if same(before, &current) && same(before, &input.metadata().map_err(|_| failed())?) {
        Ok(())
    } else {
        Err(failed())
    }
}
fn partition(name: &str) -> Result<Option<i64>> {
    let Some(stem) = name.strip_suffix(".jsonl") else {
        return Ok(None);
    };
    let Some(date) = stem.get(..10) else {
        return Ok(None);
    };
    if stem.len() != 10
        || !date.bytes().enumerate().all(|(index, value)| {
            if [4, 7].contains(&index) {
                value == b'-'
            } else {
                value.is_ascii_digit()
            }
        })
    {
        return Ok(None);
    }
    let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| failed())?;
    let at = parsed
        .and_hms_opt(0, 0, 0)
        .ok_or_else(failed)?
        .and_utc()
        .timestamp_millis();
    if iso_timestamp(at)?.get(..10) != Some(date) {
        return Err(failed());
    }
    Ok(Some(at))
}
fn expire(directory: &PrivateDirectory, name: &str, cutoff: i64) -> Result<()> {
    let Some(at) = partition(name)? else {
        if let Some((original, pending)) = name.split_once(".pending-")
            && partition(original)?.is_some()
            && uuid_like(pending)
        {
            let file = directory.open_private(name, false)?;
            let before = file.metadata().map_err(|_| failed())?;
            if i128::from(before.mtime()) * 1000 < i128::from(cutoff) {
                unchanged(directory, name, &file, &before)?;
                directory.remove(name)?;
            }
        }
        return Ok(());
    };
    if at >= cutoff {
        return Ok(());
    }
    if at + DAY_MS <= cutoff {
        let file = directory.open_private(name, false)?;
        let before = file.metadata().map_err(|_| failed())?;
        unchanged(directory, name, &file, &before)?;
        directory.remove(name)
    } else {
        trim(directory, name, cutoff)
    }
}
fn trim(directory: &PrivateDirectory, name: &str, cutoff: i64) -> Result<()> {
    let file = directory.open_private(name, false)?;
    let before = file.metadata().map_err(|_| failed())?;
    let temporary = Pending {
        directory,
        name: format!("{name}.pending-{}", identity::id()),
    };
    directory.write_new(&temporary.name, &[])?;
    let mut output = directory.open_private(&temporary.name, false)?;
    let mut input = BufReader::with_capacity(MESSAGE_BYTES, file);
    let mut line = Vec::with_capacity(MESSAGE_BYTES);
    loop {
        line.clear();
        loop {
            let source = input.fill_buf().map_err(|_| failed())?;
            if source.is_empty() {
                break;
            }
            let count = source
                .iter()
                .position(|value| *value == b'\n')
                .map_or(source.len(), |index| index + 1);
            if line.len() + count > RECORD_BYTES + 1 {
                return Err(failed());
            }
            line.extend_from_slice(&source[..count]);
            input.consume(count);
            if line.ends_with(b"\n") {
                break;
            }
        }
        if line.is_empty() {
            break;
        }
        if !line.ends_with(b"\n") {
            return Err(failed());
        }
        let value: serde_json::Value = serde_json::from_slice(&line).map_err(|_| failed())?;
        let at = value
            .get("at")
            .and_then(serde_json::Value::as_i64)
            .filter(|value| (0..=crossfire_kernel::time::MAX_TIMESTAMP).contains(value))
            .ok_or_else(failed)?;
        if at >= cutoff {
            output.write_all(&line).map_err(|_| failed())?;
        }
    }
    unchanged(directory, name, input.get_ref(), &before)?;
    output.sync_all().map_err(|_| failed())?;
    let empty = output.metadata().map_err(|_| failed())?.len() == 0;
    drop(output);
    if empty {
        directory.remove(name)?;
    } else {
        directory.replace_file(&temporary.name, name)?;
    }
    Ok(())
}
impl Store {
    pub fn new(path: &Path, days: i64) -> Result<Self> {
        Retention::new(Some(days))?;
        Ok(Self {
            directory: PrivateDirectory::open(path, true)?,
            days,
            state: Mutex::new(State::default()),
        })
    }
    pub fn write(&self, at: i64, message: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| failed())?;
        let outcome = (|| {
            if state.closed || at < 0 {
                return Err(failed());
            }
            let iso = iso_timestamp(at)?;
            let date = iso
                .get(..10)
                .filter(|date| !date.starts_with(['+', '-']))
                .ok_or_else(failed)?;
            let mut output = self.directory.append(&format!("{date}.jsonl"))?;
            let mut remaining = message;
            loop {
                let mut end = remaining.len().min(MESSAGE_BYTES);
                while !remaining.is_char_boundary(end) {
                    end -= 1;
                }
                let bytes = serde_json::to_vec(&json!({"at":at,"message":&remaining[..end]}))
                    .map_err(|_| failed())?;
                if bytes.len() > RECORD_BYTES {
                    return Err(failed());
                }
                output
                    .write_all(&bytes)
                    .and_then(|_| output.write_all(b"\n"))
                    .map_err(|_| failed())?;
                if end == remaining.len() {
                    break;
                }
                remaining = &remaining[end..];
            }
            output.flush().map_err(|_| failed())
        })();
        state.write = outcome.as_ref().err().map(|_| failed().message);
        outcome
    }
    pub fn error(&self) -> Result<Option<String>> {
        let state = self.state.lock().map_err(|_| failed())?;
        Ok(state
            .write
            .as_ref()
            .or(state.cleanup.as_ref())
            .or(state.maintenance.as_ref())
            .cloned())
    }
    pub fn maintenance_error(&self, error: Option<&str>) -> Result<()> {
        self.state.lock().map_err(|_| failed())?.maintenance = error.map(str::to_owned);
        Ok(())
    }
    pub fn maintain(&self, now: i64) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| failed())?;
        let outcome = (|| {
            if state.closed {
                return Err(failed());
            }
            let cutoff = now.checked_sub(self.days * DAY_MS).ok_or_else(failed)?;
            let mut problem = false;
            for name in self.directory.names(100000)? {
                problem |= expire(&self.directory, &name, cutoff).is_err();
            }
            if problem { Err(failed()) } else { Ok(()) }
        })();
        state.cleanup = outcome.as_ref().err().map(|_| {
            "Platform diagnostic cleanup is unavailable; retained files require inspection"
                .to_owned()
        });
        outcome
    }
    pub fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
        }
    }
}
fn uuid_like(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, value)| {
            if [8, 13, 18, 23].contains(&index) {
                value == b'-'
            } else {
                value.is_ascii_digit() || (b'a'..=b'f').contains(&value)
            }
        })
}
