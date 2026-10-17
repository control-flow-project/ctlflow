use crate::{config::DatabaseConfig, error::failure, schema};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{
    connection::{AnsiTransactionManager, SimpleConnection, TransactionManager},
    prelude::*,
};
use std::path::Path;

pub struct Database {
    connection: SqliteConnection,
    _directory: PrivateDirectory,
}

impl Database {
    pub fn open(configuration: &DatabaseConfig) -> Result<Self> {
        match configuration {
            DatabaseConfig::Sqlite { filename } => Self::sqlite(filename),
        }
    }

    fn sqlite(path: &Path) -> Result<Self> {
        let parent = path.parent().ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "Storage requires an absolute private path",
            )
        })?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Invalid storage file name"))?;
        let directory = PrivateDirectory::open(parent, false)?;
        directory.prepared_database(name)?;
        let mut uri = url::Url::from_file_path(path)
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid storage path"))?;
        uri.query_pairs_mut().append_pair("mode", "rw");
        let mut connection = SqliteConnection::establish(uri.as_str()).map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Cannot open Knex-prepared management storage",
            )
        })?;
        schema::verify(&mut connection)?;
        connection.batch_execute("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;").map_err(failure)?;
        Ok(Self {
            connection,
            _directory: directory,
        })
    }

    pub fn connection(&mut self) -> &mut SqliteConnection {
        &mut self.connection
    }

    pub fn begin(&mut self) -> Result<()> {
        match AnsiTransactionManager::begin_transaction_sql(&mut self.connection, "BEGIN IMMEDIATE")
        {
            Ok(()) => Ok(()),
            Err(diesel::result::Error::AlreadyInTransaction) => {
                AnsiTransactionManager::begin_transaction(&mut self.connection).map_err(failure)
            }
            Err(error) => Err(failure(error)),
        }
    }

    pub fn commit(&mut self) -> Result<()> {
        AnsiTransactionManager::commit_transaction(&mut self.connection).map_err(failure)
    }
    pub fn rollback(&mut self) -> Result<()> {
        AnsiTransactionManager::rollback_transaction(&mut self.connection).map_err(failure)
    }
}
