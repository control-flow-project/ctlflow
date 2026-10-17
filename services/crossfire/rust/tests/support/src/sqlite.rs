use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

pub struct PreparedDatabase {
    path: PathBuf,
    _directory: tempfile::TempDir,
}

impl PreparedDatabase {
    pub fn copy() -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let template = std::env::var_os("CROSSFIRE_TEST_DATABASE_TEMPLATE")
            .ok_or("Prepare the shared Knex test database and set CROSSFIRE_TEST_DATABASE_TEMPLATE before storage acceptance")?;
        let directory = tempfile::tempdir()?;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
        let path = directory.path().join("management.sqlite");
        fs::copy(template, &path)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            path,
            _directory: directory,
        })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}
