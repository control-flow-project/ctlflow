use crossfire_contracts::validation as check;
use crossfire_domain::fleet::runtime::{Action, Status};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone)]
pub struct Command {
    pub id: String,
    pub fleet: String,
    pub agent: Option<String>,
    pub action: Action,
    pub status: Status,
}
#[derive(Clone)]
pub struct Message {
    pub id: String,
    pub body: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub sender: Value,
    pub agents: BTreeSet<String>,
}
#[derive(Clone)]
pub struct Snapshot {
    pub revision: i64,
    pub enabled: bool,
    pub agents: BTreeSet<String>,
    pub messages: Vec<Message>,
    pub operations: Vec<Command>,
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid fleet controller lease snapshot",
    )
}
fn ids(value: &Value) -> Result<BTreeSet<String>> {
    let values = check::list(value, 0, 100)?;
    let ids = values
        .iter()
        .map(|value| check::identifier(value).map(str::to_owned))
        .collect::<Result<BTreeSet<_>>>()?;
    if values.len() != ids.len() {
        return Err(invalid());
    }
    Ok(ids)
}
pub fn command(value: &Value, fleet: &str) -> Result<Command> {
    let source = check::object(
        value,
        &[
            "operationId",
            "fleetId",
            "agentId",
            "action",
            "expectedRevision",
            "status",
            "createdAt",
            "completedAt",
            "errorMessage",
        ],
        &[],
    )?;
    if check::identifier(&source["fleetId"])? != fleet {
        return Err(invalid());
    }
    let agent = if source["agentId"].is_null() {
        None
    } else {
        Some(check::identifier(&source["agentId"])?.to_owned())
    };
    check::integer(&source["expectedRevision"], 0, check::SAFE_INTEGER)?;
    check::integer(&source["createdAt"], 0, check::SAFE_INTEGER)?;
    if !source["completedAt"].is_null() {
        check::integer(&source["completedAt"], 0, check::SAFE_INTEGER)?;
    }
    if !source["errorMessage"].is_null() {
        check::plain_text(&source["errorMessage"], 16384)?;
    }
    Ok(Command {
        id: check::identifier(&source["operationId"])?.to_owned(),
        fleet: fleet.to_owned(),
        agent,
        action: Action::parse(check::choice(
            &source["action"],
            &["start", "stop", "reset"],
        )?)?,
        status: Status::parse(check::choice(
            &source["status"],
            &["pending", "running", "succeeded", "failed"],
        )?)?,
    })
}
pub fn parse(value: &Value, fleet: &str) -> Result<Snapshot> {
    let source = check::object(
        value,
        &[
            "fleetId",
            "revision",
            "deliveryEnabled",
            "connection",
            "agentIds",
            "messages",
            "runtimeOperations",
        ],
        &[],
    )?;
    if check::identifier(&source["fleetId"])? != fleet || source["connection"]["status"] != "online"
    {
        return Err(invalid());
    }
    let agents = ids(&source["agentIds"])?;
    let messages = check::list(&source["messages"], 0, 1)?
        .iter()
        .map(|value| {
            let message = check::object(
                value,
                &[
                    "messageId",
                    "fleetId",
                    "body",
                    "createdAt",
                    "expiresAt",
                    "sender",
                    "agentIds",
                ],
                &[],
            )?;
            if check::identifier(&message["fleetId"])? != fleet {
                return Err(invalid());
            }
            let body = check::plain_text(&message["body"], 16384)?.to_owned();
            if body.is_empty() || body.encode_utf16().count() > 4096 {
                return Err(invalid());
            }
            let created_at = check::integer(&message["createdAt"], 0, check::SAFE_INTEGER)?;
            let expires_at = check::integer(&message["expiresAt"], 0, check::SAFE_INTEGER)?;
            if expires_at <= created_at {
                return Err(invalid());
            }
            let sender = check::object(&message["sender"], &["kind", "matrixUserId"], &[])?;
            let human = check::choice(&sender["kind"], &["human", "controller"])? == "human";
            if human {
                check::matrix_user_id(&sender["matrixUserId"])?;
            } else if !sender["matrixUserId"].is_null() {
                return Err(invalid());
            }
            Ok(Message {
                id: check::identifier(&message["messageId"])?.to_owned(),
                body,
                created_at,
                expires_at,
                sender: message["sender"].clone(),
                agents: ids(&message["agentIds"])?,
            })
        })
        .collect::<Result<_>>()?;
    let operations = check::list(&source["runtimeOperations"], 0, 1)?
        .iter()
        .map(|value| {
            let command = command(value, fleet)?;
            if !matches!(command.status, Status::Pending | Status::Running) {
                return Err(invalid());
            }
            Ok(command)
        })
        .collect::<Result<_>>()?;
    Ok(Snapshot {
        revision: check::integer(&source["revision"], 0, check::SAFE_INTEGER)?,
        enabled: check::boolean(&source["deliveryEnabled"])?,
        agents,
        messages,
        operations,
    })
}
