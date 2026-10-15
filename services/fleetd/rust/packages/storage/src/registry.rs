use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_contracts::registry as check;
use fleetd_domain::{model::*, resume_selection::SelectionStore};
use serde_json::Value;
use std::{path::Path, sync::Mutex};

pub struct Registry {
    directory: PrivateDirectory,
    operations: PrivateDirectory,
    operation_owner: Mutex<()>,
    setup: crate::setup::Setup,
}
impl Registry {
    pub fn open(path: &Path) -> Result<Self> {
        let directory = PrivateDirectory::open(path, true)?;
        let operations = directory.child("operations", true)?;
        Ok(Self {
            directory,
            operations,
            operation_owner: Mutex::new(()),
            setup: crate::setup::Setup::open(path)?,
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
impl Registry {
    fn operation_read(
        &self,
        id: &str,
    ) -> Result<Option<fleetd_domain::controller_model::Operation>> {
        crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
        self.operations
            .read_optional(&format!("{id}.json"), 1048576)?
            .map(|bytes| {
                let value = serde_json::from_slice(&bytes).map_err(|_| {
                    Failure::new(ErrorCode::Invalid, "Malformed private lifecycle operation")
                })?;
                let operation = fleetd_contracts::operation::parse(&value)?;
                if operation.request.id != id {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Operation file identity mismatch",
                    ));
                }
                Ok(operation)
            })
            .transpose()
    }
    fn operation_files(&self) -> Result<Vec<String>> {
        let mut files = Vec::new();
        for name in self.operations.names(100000)? {
            if let Some(id) = name.strip_prefix(".pending-") {
                crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
                self.operations.remove(&name)?;
                continue;
            }
            let id = name.strip_suffix(".json").ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Unexpected file in private operation storage",
                )
            })?;
            crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
            files.push(id.to_owned());
        }
        Ok(files)
    }
}
impl fleetd_domain::controller_ports::Registry for Registry {
    fn registrations(&self) -> Result<Vec<Registration>> {
        Registry::registrations(self)
    }
    fn save_registrations(&self, values: &[Registration]) -> Result<()> {
        Registry::save_registrations(self, values)
    }
    fn desired(&self) -> Result<Vec<DesiredIntent>> {
        Registry::desired(self)
    }
    fn save_desired(&self, values: &[DesiredIntent]) -> Result<()> {
        Registry::save_desired(self, values)
    }
    fn pending_operations(&self) -> Result<Vec<fleetd_domain::controller_model::Operation>> {
        let _gate = self.operation_owner.lock().map_err(|_| {
            Failure::new(ErrorCode::Unavailable, "Operation storage ownership failed")
        })?;
        let mut pending = Vec::new();
        for id in self.operation_files()? {
            let operation = self.operation_read(&id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Operation disappeared during inspection",
                )
            })?;
            if operation.completed_at.is_none() || operation.receipt_pending {
                pending.push(operation);
            }
        }
        Ok(pending)
    }
    fn operation(&self, id: &str) -> Result<Option<fleetd_domain::controller_model::Operation>> {
        let _gate = self.operation_owner.lock().map_err(|_| {
            Failure::new(ErrorCode::Unavailable, "Operation storage ownership failed")
        })?;
        self.operation_read(id)
    }
    fn save_operation(&self, value: &fleetd_domain::controller_model::Operation) -> Result<()> {
        let encoded = fleetd_contracts::operation::value(value);
        fleetd_contracts::operation::parse(&encoded)?;
        let bytes = serde_json::to_vec(&encoded)
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Operation encoding failed"))?;
        if bytes.len() > 1048576 {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Operation exceeds its bounded private record",
            ));
        }
        let _gate = self.operation_owner.lock().map_err(|_| {
            Failure::new(ErrorCode::Unavailable, "Operation storage ownership failed")
        })?;
        self.operations
            .write_atomic(&format!("{}.json", value.request.id), &bytes)
    }
    fn prune_operations(&self, cutoff: i64, maximum: usize) -> Result<bool> {
        if !(1..=1000).contains(&maximum) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid operation retention boundary",
            ));
        }
        let _gate = self.operation_owner.lock().map_err(|_| {
            Failure::new(ErrorCode::Unavailable, "Operation storage ownership failed")
        })?;
        let mut removed = 0;
        for id in self.operation_files()? {
            let operation = self.operation_read(&id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Operation disappeared during cleanup",
                )
            })?;
            if operation.completed_at.is_some_and(|at| at < cutoff) && !operation.receipt_pending {
                self.operations.remove(&format!("{id}.json"))?;
                removed += 1;
                if removed >= maximum {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    fn load(&self, directory: &Path) -> Result<Configuration> {
        crate::configuration::load(directory, None)
    }
    fn write_roster(
        &self,
        configuration: &Configuration,
        roster: &Roster,
    ) -> Result<Configuration> {
        crate::configuration::write_roster(configuration, roster)
    }
    fn setup(
        &self,
        request: &fleetd_domain::controller_model::SetupRequest,
    ) -> Result<fleetd_domain::controller_model::SetupConfiguration> {
        self.setup.prepare(request)
    }
    fn complete_setup(&self, id: &str) -> Result<()> {
        self.setup.complete(id)
    }
    fn retry_setup(&self, previous: &str, next: &str) -> Result<()> {
        self.setup.retry(previous, next)
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
