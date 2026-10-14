use super::{
    authority::requester_authorized,
    control::{authorized_fleet, connection_view, live_connection},
    values::FleetActor,
};
use crate::{
    identity::{Page, PrincipalKind},
    port::{Audit, FleetRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Start,
    Stop,
    Reset,
}

impl Action {
    pub fn code(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Reset => "reset",
        }
    }
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "start" => Ok(Self::Start),
            "stop" => Ok(Self::Stop),
            "reset" => Ok(Self::Reset),
            _ => Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid runtime operation action",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pending,
    Running,
    Succeeded,
    Failed,
}

impl Status {
    pub fn code(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            _ => Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid runtime operation status",
            )),
        }
    }
    pub fn settled(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Operation {
    pub operation_id: String,
    pub fleet_id: String,
    pub agent_id: Option<String>,
    pub action: Action,
    pub expected_revision: i64,
    pub author_principal_id: String,
    pub status: Status,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
    pub connection_id: Option<String>,
    pub credential_id: Option<String>,
}

pub struct Request {
    pub operation_id: String,
    pub agent_id: Option<String>,
    pub action: Action,
    pub expected_revision: i64,
    pub confirm_fresh_history: bool,
}
pub struct Receipt {
    pub connection_id: String,
    pub status: Status,
    pub error_message: Option<String>,
}

pub trait Repository: FleetRepository {
    fn runtime_operation(&mut self, id: &str) -> Result<Option<Operation>>;
    fn pending_runtime_operation(&mut self, fleet_id: &str) -> Result<Option<Operation>>;
    fn runtime_operations(
        &mut self,
        fleet_id: &str,
        page: i64,
        page_size: i64,
    ) -> Result<Page<Operation>>;
    fn insert_runtime_operation(&mut self, value: &Operation) -> Result<()>;
    fn save_runtime_operation(&mut self, value: &Operation) -> Result<()>;
}

pub fn request(
    repo: &mut impl Repository,
    actor: &FleetActor,
    fleet_id: &str,
    input: &Request,
    request_id: &str,
    now: i64,
) -> Result<Operation> {
    let FleetActor::Principal(principal) = actor else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only the fleet owner or an administrator may request session operations",
        ));
    };
    if principal.kind != PrincipalKind::Human {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only the fleet owner or an administrator may request session operations",
        ));
    }
    if input.confirm_fresh_history != (input.action == Action::Reset) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Fresh history requires explicit confirmation",
        ));
    }
    repo.transaction(|repo| {
        let mut fleet = authorized_fleet(repo, actor, fleet_id, true, now)?;
        if let Some(previous) = repo.runtime_operation(&input.operation_id)? {
            return if previous.fleet_id == fleet_id
                && previous.author_principal_id == principal.principal_id
                && previous.agent_id == input.agent_id
                && previous.action == input.action
                && previous.expected_revision == input.expected_revision
            {
                Ok(previous)
            } else {
                Err(Failure::new(
                    ErrorCode::Conflict,
                    "Operation ID belongs to a different session request",
                ))
            };
        }
        if fleet.revision != input.expected_revision {
            return Err(Failure::new(
                ErrorCode::StaleRevision,
                "Refresh the fleet before changing sessions",
            ));
        }
        if !connection_view(repo.fleet_connection(fleet_id)?.as_ref(), now).online {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Connect the fleet controller before changing sessions",
            ));
        }
        let instances = repo.current_fleet_instances(&fleet)?;
        if instances.is_empty()
            || input
                .agent_id
                .as_ref()
                .is_some_and(|id| !instances.iter().any(|instance| instance.agent_id == *id))
        {
            return Err(Failure::new(
                ErrorCode::Missing,
                "The target is not an enrolled agent in this fleet",
            ));
        }
        if repo.pending_runtime_operation(fleet_id)?.is_some() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "A session operation is already pending for this fleet",
            ));
        }
        let value = Operation {
            operation_id: input.operation_id.clone(),
            fleet_id: fleet_id.to_owned(),
            agent_id: input.agent_id.clone(),
            action: input.action,
            expected_revision: input.expected_revision,
            author_principal_id: principal.principal_id.clone(),
            status: Status::Pending,
            created_at: now,
            completed_at: None,
            error_message: None,
            connection_id: None,
            credential_id: None,
        };
        repo.insert_runtime_operation(&value)?;
        fleet.revision = fleet
            .revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Fleet revision exhausted"))?;
        fleet.updated_at = now;
        repo.save_fleet(&fleet)?;
        let mut audit = Audit::new(
            principal,
            request_id,
            "fleet",
            fleet_id,
            &format!("fleet.session.{}", input.action.code()),
            Some(&fleet.owner_id),
            now,
        );
        audit.message = input.operation_id.clone();
        repo.audit(&audit)?;
        Ok(value)
    })
}

pub fn list(
    repo: &mut impl Repository,
    actor: &FleetActor,
    fleet_id: &str,
    page: i64,
    page_size: i64,
    now: i64,
) -> Result<Page<Operation>> {
    authorized_fleet(repo, actor, fleet_id, false, now)?;
    repo.runtime_operations(fleet_id, page, page_size)
}

pub fn claim(
    repo: &mut impl Repository,
    actor: &FleetActor,
    fleet_id: &str,
    operation_id: &str,
    connection_id: &str,
    now: i64,
) -> Result<Operation> {
    repo.transaction(|repo| {
        let (fleet, connection) = live_connection(repo, actor, fleet_id, connection_id, now)?;
        let mut operation = repo.runtime_operation(operation_id)?.filter(|value| value.fleet_id == fleet_id)
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Session operation not found"))?;
        if operation.status.settled() { return Ok(operation); }
        let allowed = requester_authorized(repo, &operation.author_principal_id, &fleet)?;
        let instances = repo.current_fleet_instances(&fleet)?;
        let valid = allowed && (operation.status != Status::Pending || operation.expected_revision.checked_add(1) == Some(fleet.revision))
            && (operation.agent_id.as_ref().is_none_or(|id| instances.iter().any(|instance| instance.agent_id == *id)));
        if valid { operation.status = Status::Running; operation.connection_id = Some(connection_id.to_owned()); operation.credential_id = Some(connection.credential_id); }
        else {
            operation.error_message = Some(if operation.status == Status::Pending { "Session request authority or roster changed before execution" }
                else { "Session request authority or roster changed after execution was claimed; inspect the controller’s native operation outcome" }.to_owned());
            operation.status = Status::Failed; operation.completed_at = Some(now);
        }
        repo.save_runtime_operation(&operation)?;
        Ok(operation)
    })
}

pub fn receipt(
    repo: &mut impl Repository,
    actor: &FleetActor,
    fleet_id: &str,
    operation_id: &str,
    input: &Receipt,
    now: i64,
) -> Result<bool> {
    if !input.status.settled() || (input.status == Status::Failed) != input.error_message.is_some()
    {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid session receipt"));
    }
    repo.transaction(|repo| {
        let (_, connection) = live_connection(repo, actor, fleet_id, &input.connection_id, now)?;
        let Some(mut operation) = repo.runtime_operation(operation_id)? else { return Ok(false); };
        if operation.fleet_id != fleet_id { return Err(Failure::new(ErrorCode::Missing, "Session operation not found")); }
        if operation.status.settled() { return if operation.status == input.status && operation.error_message == input.error_message { Ok(true) }
            else { Err(Failure::new(ErrorCode::Conflict, "This session operation already has a different final outcome")) }; }
        if operation.status != Status::Running || operation.connection_id.as_deref() != Some(&input.connection_id)
            || operation.credential_id.as_deref() != Some(&connection.credential_id) {
            return Err(Failure::new(ErrorCode::Conflict, "Claim this operation on the current controller connection before reporting its outcome"));
        }
        operation.status = input.status; operation.error_message = input.error_message.clone(); operation.completed_at = Some(now);
        repo.save_runtime_operation(&operation)?;
        Ok(true)
    })
}
