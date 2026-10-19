use crossfire_contracts::{origin, validation as check};
pub use crossfire_domain::messaging::Account;
use crossfire_domain::messaging::BackendConfiguration;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub instance: String,
    pub server: String,
    pub backend: BackendConfiguration,
    pub owner: String,
    pub max_upload_bytes: usize,
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
    let account = crossfire_contracts::messaging::account(&root["account"])?;
    let settings = check::object(
        &root["settings"],
        &["instance", "server", "backend", "owner", "maxUploadBytes"],
        &[],
    )?;
    let workspace = PathBuf::from(check::text(&root["workspace"], 1, 4096)?);
    if !workspace.is_absolute() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Agent workspaces must be fully qualified",
        ));
    }
    let server = check::text(&settings["server"], 1, 2048)?;
    origin::parse(server)?;
    Ok(Profile {
        workspace,
        id: check::identifier(&root["id"])?.to_owned(),
        account,
        settings: Settings {
            instance: check::name(&settings["instance"])?.to_owned(),
            server: server.to_owned(),
            backend: crossfire_contracts::messaging::configuration(&settings["backend"])?,
            owner: check::backend_user_id(&settings["owner"])?.to_owned(),
            max_upload_bytes: check::integer(&settings["maxUploadBytes"], 1, 16 * 1024 * 1024)?
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
        json!({"id":profile.id,"workspace":workspace,"account":crossfire_contracts::messaging::account_value(&profile.account),"settings":{"instance":profile.settings.instance,"server":profile.settings.server,"backend":crossfire_contracts::messaging::configuration_value(&profile.settings.backend),"owner":profile.settings.owner,"maxUploadBytes":profile.settings.max_upload_bytes}}),
    )
}
