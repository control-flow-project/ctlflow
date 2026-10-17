use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DatabaseConfig {
    Sqlite { filename: PathBuf },
}
