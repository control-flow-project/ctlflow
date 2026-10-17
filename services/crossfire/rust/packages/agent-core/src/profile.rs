use crossfire_contracts::{origin, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub instance: String,
    pub homeserver: String,
    pub server_name: String,
    pub owner: String,
    pub max_upload_bytes: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub user_id: String,
    pub access_token: Secret,
    pub device_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub settings: Settings,
    pub workspace: PathBuf,
    pub id: String,
    pub account: Account,
}
pub fn parse(value: &Value) -> Result<Profile> {
    let root = check::object(value, &["id", "workspace", "account", "settings"], &[])?;
    let account = check::object(
        &root["account"],
        &["user_id", "access_token", "device_id"],
        &[],
    )?;
    let settings = check::object(
        &root["settings"],
        &[
            "instance",
            "homeserver",
            "server_name",
            "owner",
            "max_upload_bytes",
        ],
        &[],
    )?;
    let workspace = PathBuf::from(check::text(&root["workspace"], 1, 4096)?);
    if !workspace.is_absolute() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Agent workspaces must be fully qualified",
        ));
    }
    let homeserver = check::text(&settings["homeserver"], 1, 2048)?;
    origin::parse(homeserver)?;
    Ok(Profile {
        workspace,
        id: check::identifier(&root["id"])?.to_owned(),
        account: Account {
            user_id: check::matrix_user_id(&account["user_id"])?.to_owned(),
            access_token: Secret::new(check::text(&account["access_token"], 1, 8192)?.to_owned()),
            device_id: check::text(&account["device_id"], 1, 255)?.to_owned(),
        },
        settings: Settings {
            instance: check::text(&settings["instance"], 1, 100)?.to_owned(),
            homeserver: homeserver.to_owned(),
            server_name: check::text(&settings["server_name"], 1, 255)?.to_owned(),
            owner: check::matrix_user_id(&settings["owner"])?.to_owned(),
            max_upload_bytes: check::integer(&settings["max_upload_bytes"], 1, 16 * 1024 * 1024)?
                as usize,
        },
    })
}
pub fn value(profile: &Profile) -> Result<Value> {
    let workspace = profile
        .workspace
        .to_str()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Agent workspace is not valid Unicode"))?;
    Ok(
        json!({"id":profile.id,"workspace":workspace,"account":{"user_id":profile.account.user_id,"access_token":profile.account.access_token.expose(),"device_id":profile.account.device_id},"settings":{"instance":profile.settings.instance,"homeserver":profile.settings.homeserver,"server_name":profile.settings.server_name,"owner":profile.settings.owner,"max_upload_bytes":profile.settings.max_upload_bytes}}),
    )
}
