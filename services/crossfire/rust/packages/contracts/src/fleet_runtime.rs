use crate::validation as check;
use crossfire_domain::fleet::runtime::{Action, Operation, Receipt, Request, Status};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Serialize, Serializer, ser::SerializeStruct};
use serde_json::Value;

pub fn request(value: &Value) -> Result<Request> {
    let object = check::object(
        value,
        &[
            "operationId",
            "agentId",
            "action",
            "expectedRevision",
            "confirmFreshHistory",
        ],
        &[],
    )?;
    let input = Request {
        operation_id: check::identifier(&object["operationId"])?.to_owned(),
        agent_id: if object["agentId"].is_null() {
            None
        } else {
            Some(check::identifier(&object["agentId"])?.to_owned())
        },
        action: Action::parse(check::choice(
            &object["action"],
            &["start", "stop", "reset"],
        )?)?,
        expected_revision: check::integer(&object["expectedRevision"], 0, check::SAFE_INTEGER)?,
        confirm_fresh_history: check::boolean(&object["confirmFreshHistory"])?,
    };
    if input.confirm_fresh_history != (input.action == Action::Reset) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Fresh history requires explicit confirmation",
        ));
    }
    Ok(input)
}

pub fn receipt(value: &Value) -> Result<Receipt> {
    let object = check::object(value, &["connectionId", "status", "errorMessage"], &[])?;
    let input = Receipt {
        connection_id: check::identifier(&object["connectionId"])?.to_owned(),
        status: Status::parse(check::choice(&object["status"], &["succeeded", "failed"])?)?,
        error_message: if object["errorMessage"].is_null() {
            None
        } else {
            Some(check::text(&object["errorMessage"], 1, 4096)?.to_owned())
        },
    };
    if (input.status == Status::Failed) != input.error_message.is_some() {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid session receipt"));
    }
    Ok(input)
}

pub struct OperationWire<'a>(pub &'a Operation);

impl Serialize for OperationWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut view = serializer.serialize_struct("FleetRuntimeOperation", 9)?;
        view.serialize_field("operationId", &self.0.operation_id)?;
        view.serialize_field("fleetId", &self.0.fleet_id)?;
        view.serialize_field("agentId", &self.0.agent_id)?;
        view.serialize_field("action", self.0.action.code())?;
        view.serialize_field("expectedRevision", &self.0.expected_revision)?;
        view.serialize_field("status", self.0.status.code())?;
        view.serialize_field("createdAt", &self.0.created_at)?;
        view.serialize_field("completedAt", &self.0.completed_at)?;
        view.serialize_field("errorMessage", &self.0.error_message)?;
        view.end()
    }
}
