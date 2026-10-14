use crate::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{Connection, RunQueryDsl, SqliteConnection, sql_types::Text};
use std::{
    collections::HashSet,
    fs::File,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static OWNERS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn conflict() -> Failure {
    Failure::new(
        ErrorCode::Conflict,
        "Another process already owns this private state",
    )
}

struct Reservation(PathBuf);

impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut owners) = OWNERS.get_or_init(Mutex::default).lock() {
            owners.remove(&self.0);
        }
    }
}

pub struct StateLock {
    _connection: SqliteConnection,
    _descriptor: File,
    _reservation: Reservation,
}

impl StateLock {
    pub fn acquire(path: &Path) -> Result<Self> {
        if !path.is_absolute()
            || path.components().any(|part| {
                matches!(
                    part,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use an exact absolute private lock path",
            ));
        }
        let parent = path.parent().ok_or_else(conflict)?;
        let leaf = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(conflict)?;
        let name = format!("{leaf}.lock");
        let file = parent.join(&name);
        let mut owners = OWNERS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| conflict())?;
        if !owners.insert(file.clone()) {
            return Err(conflict());
        }
        drop(owners);
        let reservation = Reservation(file.clone());
        let directory = PrivateDirectory::open(parent, true)?;
        let descriptor = directory.open_private(&name, true)?;
        let mut uri = url::Url::from_file_path(&file).map_err(|_| conflict())?;
        uri.query_pairs_mut().append_pair("mode", "rw");
        let mut connection = SqliteConnection::establish(uri.as_str()).map_err(|_| conflict())?;
        diesel::sql_query("PRAGMA busy_timeout = 0")
            .execute(&mut connection)
            .map_err(|_| conflict())?;
        #[derive(diesel::QueryableByName)]
        struct JournalMode {
            #[diesel(sql_type = Text)]
            journal_mode: String,
        }
        let selected = diesel::sql_query("PRAGMA journal_mode = MEMORY")
            .get_result::<JournalMode>(&mut connection)
            .map_err(|_| conflict())?;
        if selected.journal_mode != "memory" {
            return Err(conflict());
        }
        use std::os::unix::fs::MetadataExt;
        let current = directory
            .open_private(&name, false)?
            .metadata()
            .map_err(|_| conflict())?;
        let original = descriptor.metadata().map_err(|_| conflict())?;
        if current.dev() != original.dev() || current.ino() != original.ino() {
            return Err(conflict());
        }
        diesel::sql_query("BEGIN EXCLUSIVE")
            .execute(&mut connection)
            .map_err(|_| conflict())?;
        Ok(Self {
            _connection: connection,
            _descriptor: descriptor,
            _reservation: reservation,
        })
    }
}
