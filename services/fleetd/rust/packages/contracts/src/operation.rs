use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::controller_model::*;
use serde_json::{Value, json};
use std::path::PathBuf;

pub fn request(value: &Value, stored: bool) -> Result<OperationRequest> {
    let source = check::object(
        value,
        &["operationId", "target", "action", "expectedRevision"],
        if stored {
            &[
                "releaseDirectory",
                "receiptPending",
                "status",
                "createdAt",
                "completedAt",
                "approval",
                "errors",
            ]
        } else {
            &["releaseDirectory"]
        },
    )?;
    let target = check::object(&source["target"], &["kind"], &["fleetId", "instanceKey"])?;
    let kind = check::choice(&target["kind"], &["fleet", "agent", "daemon"])?;
    let fleet = target
        .get("fleetId")
        .map(check::identifier)
        .transpose()?
        .map(str::to_owned);
    let instance = target
        .get("instanceKey")
        .map(check::name)
        .transpose()?
        .map(str::to_owned);
    let action = match check::choice(
        &source["action"],
        &["enroll", "start", "stop", "reset", "update"],
    )? {
        "enroll" => Action::Enroll,
        "start" => Action::Start,
        "stop" => Action::Stop,
        "reset" => Action::Reset,
        _ => Action::Update,
    };
    let invalid = || {
        Failure::new(
            ErrorCode::Invalid,
            "Invalid lifecycle operation identity, target or release directory",
        )
    };
    let target = match (kind, fleet, instance) {
        ("daemon", None, None) if action == Action::Stop => Target::Daemon,
        ("fleet", Some(fleet), None) => Target::Fleet(fleet),
        ("agent", Some(fleet), Some(instance)) => Target::Agent { fleet, instance },
        _ => return Err(invalid()),
    };
    let release_directory = source
        .get("releaseDirectory")
        .map(|value| {
            let value = check::text(value, 1, 4096)?;
            if !crate::configuration::absolute_path(value) {
                return Err(invalid());
            }
            Ok(PathBuf::from(value))
        })
        .transpose()?;
    if (action == Action::Update) != release_directory.is_some() {
        return Err(invalid());
    }
    Ok(OperationRequest {
        id: check::identifier(&source["operationId"])?.to_owned(),
        target,
        action,
        expected_revision: check::integer(&source["expectedRevision"], 0, check::SAFE_INTEGER)?,
        release_directory,
    })
}
pub fn target(value: &Target) -> Value {
    match value {
        Target::Daemon => json!({"kind":"daemon"}),
        Target::Fleet(fleet) => json!({"kind":"fleet","fleetId":fleet}),
        Target::Agent { fleet, instance } => {
            json!({"kind":"agent","fleetId":fleet,"instanceKey":instance})
        }
    }
}
pub fn request_wire(value: &OperationRequest) -> Value {
    let mut wire = json!({"operationId":value.id,"target":target(&value.target),"action":value.action.code(),"expectedRevision":value.expected_revision});
    if let Some(directory) = &value.release_directory {
        wire["releaseDirectory"] = json!(directory);
    }
    wire
}
pub fn value(value: &Operation) -> Value {
    let mut wire = request_wire(&value.request);
    wire["status"] = json!(value.status.code());
    wire["createdAt"] = json!(value.created_at);
    wire["completedAt"] = json!(value.completed_at);
    wire["approval"] = value.approval.as_ref().map_or(
        Value::Null,
        |approval| json!({"url":approval.url,"code":approval.code}),
    );
    wire["errors"] = json!(value.errors.iter().map(|error| json!({"instanceKey":error.instance,"code":error.code,"message":error.message})).collect::<Vec<_>>());
    if value.receipt_pending {
        wire["receiptPending"] = json!(true);
    }
    wire
}
pub fn parse(value: &Value) -> Result<Operation> {
    let request = request(value, true)?;
    let source = value
        .as_object()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Invalid retained operation"))?;
    let required = |key: &str| {
        source.get(key).ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "Incomplete retained lifecycle operation",
            )
        })
    };
    let status = match check::choice(
        required("status")?,
        &[
            "accepted",
            "running",
            "awaiting-approval",
            "succeeded",
            "failed",
        ],
    )? {
        "accepted" => OperationStatus::Accepted,
        "running" => OperationStatus::Running,
        "awaiting-approval" => OperationStatus::AwaitingApproval,
        "succeeded" => OperationStatus::Succeeded,
        _ => OperationStatus::Failed,
    };
    let created_at = check::integer(required("createdAt")?, 0, check::SAFE_INTEGER)?;
    let completed_at = if required("completedAt")?.is_null() {
        None
    } else {
        Some(check::integer(
            required("completedAt")?,
            0,
            check::SAFE_INTEGER,
        )?)
    };
    let approval = if required("approval")?.is_null() {
        None
    } else {
        let link = check::object(required("approval")?, &["url", "code"], &[])?;
        Some(ApprovalLink {
            url: check::text(&link["url"], 1, 2048)?.to_owned(),
            code: check::text(&link["code"], 12, 12)?.to_owned(),
        })
    };
    let errors = check::list(required("errors")?, 0, 100)?
        .iter()
        .map(|error| {
            let error = check::object(error, &["instanceKey", "code", "message"], &[])?;
            let instance = if error["instanceKey"].is_null() {
                None
            } else {
                Some(check::name(&error["instanceKey"])?.to_owned())
            };
            Ok(OperationError {
                instance,
                code: check::text(&error["code"], 1, 100)?.to_owned(),
                message: check::text(&error["message"], 1, 4096)?.to_owned(),
            })
        })
        .collect::<Result<_>>()?;
    let receipt_pending = match source.get("receiptPending") {
        Some(Value::Bool(true)) => true,
        None => false,
        _ => {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Only unacknowledged controller requests are pinned",
            ));
        }
    };
    Ok(Operation {
        request,
        status,
        created_at,
        completed_at,
        approval,
        errors,
        receipt_pending,
    })
}
