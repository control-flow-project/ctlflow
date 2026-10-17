use crate::arguments::invalid;
use crossfire_adapter_filesystem::absolute_state::AbsoluteState;
use crossfire_agent_core::local_state;
use crossfire_contracts::validation as check;
use crossfire_kernel::{Result, identity};
use fleet_ssh_transport::{valid_host, valid_root};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Remote {
    pub name: String,
    pub ssh: String,
    pub root: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Settings {
    pub local_root: Option<PathBuf>,
    pub remotes: Vec<Remote>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub workspace: PathBuf,
    pub descriptor: String,
    pub root: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<PathBuf>,
}
pub fn home() -> Result<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| invalid("An absolute HOME is required"))
}
fn root() -> Result<PathBuf> {
    let path = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".config"));
    if !path.is_absolute() {
        return Err(invalid("XDG_CONFIG_HOME must be absolute"));
    }
    Ok(path.join("fleet"))
}
pub fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| invalid("Paths must be valid Unicode"))
}
pub fn absolute(path: &str) -> Result<PathBuf> {
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|_| invalid("Working directory unavailable"))?
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            value => normalized.push(value.as_os_str()),
        }
    }
    Ok(normalized)
}
pub fn load() -> Result<Settings> {
    let value: Settings = local_state::read(
        &AbsoluteState,
        text(&root()?.join("connections.json"))?,
        1048576,
    )?
    .unwrap_or_default();
    if value
        .local_root
        .as_ref()
        .is_some_and(|path| !path.is_absolute())
        || value.remotes.len() > 100
    {
        return Err(invalid("Invalid saved controller connection"));
    }
    let mut names = std::collections::BTreeSet::new();
    for remote in &value.remotes {
        check::name(&json!(remote.name))?;
        if !names.insert(&remote.name) || !valid_host(&remote.ssh) || !valid_root(&remote.root) {
            return Err(invalid("Invalid saved SSH controller connection"));
        }
    }
    Ok(value)
}
pub fn save(value: &Settings) -> Result<()> {
    local_state::write(
        &AbsoluteState,
        text(&root()?.join("connections.json"))?,
        value,
        1048576,
    )
}
fn project_file(workspace: &Path) -> Result<PathBuf> {
    Ok(root()?
        .join("projects")
        .join(format!("{}.json", identity::hash(text(workspace)?))))
}
pub fn project(workspace: &Path) -> Result<Option<Project>> {
    let value: Option<Project> =
        local_state::read(&AbsoluteState, text(&project_file(workspace)?)?, 1048576)?;
    if let Some(value) = &value {
        if value.workspace != workspace
            || !value.root.is_absolute()
            || value.configuration.as_ref().is_some_and(|path| {
                !path.is_absolute() || path.file_name().is_none_or(|name| name != "runtime.toml")
            })
        {
            return Err(invalid("Invalid saved project setup authority"));
        }
        crate::setup::descriptor_url(&value.descriptor)?;
    }
    Ok(value)
}
pub fn save_project(value: &Project) -> Result<()> {
    local_state::write(
        &AbsoluteState,
        text(&project_file(&value.workspace)?)?,
        value,
        1048576,
    )
}
