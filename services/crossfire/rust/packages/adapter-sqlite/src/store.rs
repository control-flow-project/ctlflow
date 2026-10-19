use crate::{config::DatabaseConfig, db::Database, schema};
use crossfire_domain::port::UnitOfWork;
use crossfire_kernel::Result;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct SharedStore(Arc<Mutex<Store>>);
impl SharedStore {
    pub fn new(store: Store) -> Self {
        Self(Arc::new(Mutex::new(store)))
    }
}
impl crossfire_domain::port::RepositoryAccess for SharedStore {
    type Repository = Store;
    fn with<T>(&self, operation: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        let mut store = self.0.lock().map_err(|_| {
            crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Unavailable,
                "Management repository ownership failed",
            )
        })?;
        operation(&mut store)
    }
}

pub struct Store {
    pub(crate) database: Database,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let database = Database::open(&DatabaseConfig::Sqlite {
            filename: path.to_owned(),
        })?;
        Ok(Self { database })
    }

    pub fn schema_identity(&mut self) -> Result<(i64, i64)> {
        Ok((
            schema::pragma(self.database.connection(), "application_id")?,
            schema::pragma(self.database.connection(), "user_version")?,
        ))
    }
}

impl UnitOfWork for Store {
    fn transaction<T>(&mut self, operation: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.database.begin()?;
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(self)));
        match outcome {
            Ok(Ok(value)) => {
                self.database.commit()?;
                Ok(value)
            }
            Ok(Err(error)) => {
                self.database.rollback()?;
                Err(error)
            }
            Err(panic) => {
                let _cleanup = self.database.rollback();
                std::panic::resume_unwind(panic)
            }
        }
    }
}
