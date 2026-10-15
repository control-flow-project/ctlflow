use crate::{invalid, zones};
use chrono::{DateTime, Datelike, FixedOffset, LocalResult, NaiveDateTime, Timelike, Utc};
use crossfire_adapter_filesystem::assets::Directory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

pub struct Zone(tz::TimeZone);
struct Database {
    directory: Directory,
    loaded: Mutex<BTreeMap<&'static str, Arc<Zone>>>,
}
static DATABASE: OnceLock<Database> = OnceLock::new();
fn failed() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "The selected native IANA timezone database is unavailable or invalid",
    )
}
fn database() -> Result<&'static Database> {
    if let Some(database) = DATABASE.get() {
        return Ok(database);
    }
    let root = std::env::var_os("TZDIR")
        .map_or_else(|| PathBuf::from("/usr/share/zoneinfo"), PathBuf::from);
    let directory = Directory::open(&root)?;
    let _ = DATABASE.set(Database {
        directory,
        loaded: Mutex::new(BTreeMap::new()),
    });
    DATABASE.get().ok_or_else(failed)
}
pub fn version() -> &'static str {
    zones::VERSION
}
pub fn zone(source: &str) -> Result<Arc<Zone>> {
    if source.is_empty() || source.len() > 100 || !source.is_ascii() {
        return Err(invalid("Choose an IANA time zone"));
    }
    let index = zones::ZONES
        .binary_search_by(|(name, _)| {
            name.bytes()
                .map(|value| value.to_ascii_lowercase())
                .cmp(source.bytes().map(|value| value.to_ascii_lowercase()))
        })
        .map_err(|_| invalid("Unknown IANA time zone"))?;
    let canonical = zones::ZONES[index].1;
    let database = database()?;
    let mut loaded = database.loaded.lock().map_err(|_| failed())?;
    if let Some(zone) = loaded.get(canonical) {
        return Ok(zone.clone());
    }
    let bytes = database
        .directory
        .file(canonical, 1048576)?
        .ok_or_else(failed)?
        .read(1048576)?;
    let data = tz::TimeZone::from_tz_data(&bytes).map_err(|_| failed())?;
    let zone = Arc::new(Zone(data));
    loaded.insert(canonical, zone.clone());
    Ok(zone)
}
impl Zone {
    pub fn at(&self, instant: DateTime<Utc>) -> Result<DateTime<FixedOffset>> {
        let seconds = self
            .0
            .find_local_time_type(instant.timestamp())
            .map_err(|_| failed())?
            .ut_offset();
        let offset = FixedOffset::east_opt(seconds).ok_or_else(failed)?;
        Ok(instant.with_timezone(&offset))
    }
    pub fn local(&self, local: NaiveDateTime) -> Result<LocalResult<DateTime<FixedOffset>>> {
        let mut buffer = [None; 4];
        let found = tz::DateTime::find_n(
            &mut buffer,
            local.year(),
            local.month() as u8,
            local.day() as u8,
            local.hour() as u8,
            local.minute() as u8,
            local.second() as u8,
            local.nanosecond(),
            self.0.as_ref(),
        )
        .map_err(|_| failed())?;
        if !found.is_exhaustive() {
            return Err(invalid(
                "Timezone local-time multiplicity exceeds the accepted native database contract",
            ));
        }
        let mut first = None;
        let mut last = None;
        for value in found.data().iter().flatten() {
            if let tz::datetime::FoundDateTimeKind::Normal(value) = value {
                let instant =
                    DateTime::<Utc>::from_timestamp(value.unix_time(), value.nanoseconds())
                        .ok_or_else(failed)?;
                let candidate = self.at(instant)?;
                first = Some(first.map_or(candidate, |previous: DateTime<FixedOffset>| {
                    previous.min(candidate)
                }));
                last = Some(last.map_or(candidate, |previous: DateTime<FixedOffset>| {
                    previous.max(candidate)
                }));
            }
        }
        match (first, last) {
            (None, None) => Ok(LocalResult::None),
            (Some(first), Some(last)) if first == last => Ok(LocalResult::Single(first)),
            (Some(first), Some(last)) => Ok(LocalResult::Ambiguous(first, last)),
            _ => Err(failed()),
        }
    }
}
