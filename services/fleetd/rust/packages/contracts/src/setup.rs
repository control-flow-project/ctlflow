use crossfire_contracts::{origin, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::controller_model::{SetupDescriptor, SetupRequest};
use serde_json::Value;
use std::path::PathBuf;

pub fn descriptor(value: &Value) -> Result<SetupDescriptor> {
    let value = check::object(
        value,
        &[
            "schemaVersion",
            "server",
            "ownerBackendUserId",
            "package",
            "instructions",
        ],
        &[],
    )?;
    check::integer(&value["schemaVersion"], 1, 1)?;
    let package = check::object(&value["package"], &["name", "version"], &[])?;
    check::choice(&package["name"], &["@ctlflow/fleet"])?;
    let version = check::text(&package["version"], 1, 100)?;
    if version != env!("CARGO_PKG_VERSION") {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Setup descriptor requires its exact published Fleet version",
        ));
    }
    let server = check::text(&value["server"], 1, 2048)?;
    if origin::parse(server)?.origin().ascii_serialization() != server {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Setup requires a canonical Crossfire origin",
        ));
    }
    Ok(SetupDescriptor {
        server: server.to_owned(),
        owner: check::backend_user_id(&value["ownerBackendUserId"])?.to_owned(),
        package_version: version.to_owned(),
        instructions: check::plain_text(&value["instructions"], 131072)?.to_owned(),
    })
}
pub fn request(value: &Value) -> Result<SetupRequest> {
    let value = check::object(value, &["descriptor", "workspace"], &["configuration"])?;
    let path = |value: &Value| {
        let value = check::text(value, 1, 4096)?;
        if !crate::configuration::absolute_path(value) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Setup directories must be absolute and normalized",
            ));
        }
        Ok(PathBuf::from(value))
    };
    Ok(SetupRequest {
        descriptor: descriptor(&value["descriptor"])?,
        workspace: path(&value["workspace"])?,
        configuration: value.get("configuration").map(path).transpose()?,
    })
}
