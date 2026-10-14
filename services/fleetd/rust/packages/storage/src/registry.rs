use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_contracts::registry as check;
use fleetd_domain::{model::*, resume_selection::SelectionStore};
use serde_json::Value;
use std::path::Path;

pub struct Registry {
    directory: PrivateDirectory,
}
impl Registry {
    pub fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            directory: PrivateDirectory::open(path, true)?,
        })
    }
    fn read<T>(
        &self,
        name: &str,
        maximum: u64,
        parser: impl FnOnce(&Value) -> Result<T>,
    ) -> Result<T> {
        let value = match self.directory.read_optional(name, maximum)? {
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
                Failure::new(ErrorCode::Invalid, "Malformed private controller data")
            })?,
            None => Value::Array(vec![]),
        };
        parser(&value)
    }
    fn save<T>(
        &self,
        name: &str,
        maximum: usize,
        value: Value,
        parser: impl FnOnce(&Value) -> Result<T>,
        represent: impl FnOnce(&T) -> Value,
    ) -> Result<()> {
        let value = parser(&value)?;
        let bytes = serde_json::to_vec(&represent(&value))
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Cannot represent controller data"))?;
        if bytes.len() > maximum {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Private controller data exceeds its byte bound",
            ));
        }
        self.directory.write_atomic(name, &bytes)
    }
    pub fn registrations(&self) -> Result<Vec<Registration>> {
        self.read("fleets.json", 1024 * 1024, check::registrations)
    }
    pub fn save_registrations(&self, values: &[Registration]) -> Result<()> {
        self.save(
            "fleets.json",
            1024 * 1024,
            check::registrations_wire(values),
            check::registrations,
            |values| check::registrations_wire(values),
        )
    }
    pub fn desired(&self) -> Result<Vec<DesiredIntent>> {
        self.read("desired-intent.json", 2 * 1024 * 1024, check::desired)
    }
    pub fn save_desired(&self, values: &[DesiredIntent]) -> Result<()> {
        self.save(
            "desired-intent.json",
            2 * 1024 * 1024,
            check::desired_wire(values),
            check::desired,
            |values| check::desired_wire(values),
        )
    }
}
impl SelectionStore for Registry {
    fn resume_selections(&self) -> Result<Vec<ResumeSelection>> {
        self.read("resume-selections.json", 1024 * 1024, check::selections)
    }
    fn save_resume_selections(&self, values: &[ResumeSelection]) -> Result<()> {
        self.save(
            "resume-selections.json",
            1024 * 1024,
            check::selections_wire(values),
            check::selections,
            |values| check::selections_wire(values),
        )
    }
}
