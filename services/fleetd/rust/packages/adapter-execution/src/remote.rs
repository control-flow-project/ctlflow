use crossfire_adapter_crossfire::{
    fleet_connection::{Executor, Outcome},
    fleet_snapshot::Command,
};
use crossfire_domain::fleet::runtime::Action as NativeAction;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::{
    binding::Binding,
    controller_model::{Action, OperationRequest, OperationStatus, RemoteOperations},
};
use std::{path::PathBuf, sync::Weak};
use tokio_util::sync::CancellationToken;

pub struct Remote {
    pub directory: PathBuf,
    pub binding: Binding,
    pub operations: Weak<dyn RemoteOperations>,
}
impl Executor for Remote {
    async fn execute(&self, command: Command, stop: CancellationToken) -> Result<Outcome> {
        let storage = crossfire_adapter_filesystem::local_state::State::open(
            &self.directory.join(".fleet"),
            false,
        )?;
        let value = crossfire_agent_core::local_state::read::<serde_json::Value>(
            &storage,
            "binding.json",
            1048576,
        )?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Enrolled fleet binding is missing"))?;
        let binding = fleetd_contracts::binding::parse(&value)?;
        if stop.is_cancelled()
            || binding.fleet_id != self.binding.fleet_id
            || binding.fleet_id.as_deref() != Some(&command.fleet)
            || binding.server != self.binding.server
            || binding.owner != self.binding.owner
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Native operation is not authorized for this controller",
            ));
        }
        let operations = self
            .operations
            .upgrade()
            .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Controller is closing"))?;
        let instance = command
            .agent
            .as_ref()
            .map(|agent| {
                binding
                    .identities
                    .iter()
                    .find(|identity| &identity.agent_id == agent)
                    .map(|identity| identity.instance_key.as_str())
                    .ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Missing,
                            "Native operation selects an unenrolled identity",
                        )
                    })
            })
            .transpose()?;
        let request = OperationRequest {
            id: command.id,
            target: operations.target(&self.directory, instance)?,
            action: match command.action {
                NativeAction::Start => Action::Start,
                NativeAction::Stop => Action::Stop,
                NativeAction::Reset => Action::Reset,
            },
            expected_revision: 0,
            release_directory: None,
        };
        let value = operations.execute(request).await?;
        Ok(Outcome {
            succeeded: value.status == OperationStatus::Succeeded,
            error: (!value.errors.is_empty()).then(|| {
                value
                    .errors
                    .iter()
                    .map(|error| error.message.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            }),
        })
    }
    fn acknowledged(&self, id: &str) -> Result<()> {
        self.operations
            .upgrade()
            .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Controller is closing"))?
            .acknowledged(id)
    }
}
