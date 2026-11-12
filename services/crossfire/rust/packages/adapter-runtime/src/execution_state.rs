use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock, owned::OwnedFile};
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
use std::{fs, io::Read, path::Path};

pub struct ExecutionState {
    pub id: String,
    pub group: String,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}
pub fn current_group() -> Result<String> {
    let source = fs::read_to_string("/proc/self/cgroup")
        .map_err(|_| invalid("Cannot inspect native resource-group ownership"))?;
    let lines = source.lines().collect::<Vec<_>>();
    if lines.len() != 1 || !lines[0].starts_with("0::/user.slice/") {
        return Err(invalid(
            "VM execution requires a cgroup v2 user resource group",
        ));
    }
    Ok(lines[0][3..].to_owned())
}
fn group(value: &str) -> Result<bool> {
    let current = current_group()?;
    let parts = current.split('/').collect::<Vec<_>>();
    Ok(parts.len() >= 5
        && parts[2].starts_with("user-")
        && parts[2].ends_with(".slice")
        && parts[3].starts_with("user@")
        && parts[3].ends_with(".service")
        && value.starts_with(&(parts[..4].join("/") + "/"))
        && value.len() <= 4096
        && (value.ends_with(".scope") || value.ends_with(".service"))
        && value.split('/').skip(1).all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".-_@".contains(&byte))
        }))
}
fn read(directory: &Path) -> Result<Option<ExecutionState>> {
    let Some(file) = OwnedFile::open(&directory.join("execution.json"), 8192)? else {
        return Ok(None);
    };
    file.private_permissions()?;
    let value: serde_json::Value = serde_json::from_slice(&file.configuration(8192)?)
        .map_err(|_| invalid("Invalid host native execution record"))?;
    let value = check::object(&value, &["id", "group"], &[])?;
    let id = check::identifier(&value["id"])?.to_owned();
    let resource = check::text(&value["group"], 1, 4096)?.to_owned();
    if !group(&resource)? {
        return Err(invalid("Invalid host native execution resource group"));
    }
    Ok(Some(ExecutionState {
        id,
        group: resource,
    }))
}
// Caller retains the host owner lock throughout publication and VM launch.
pub fn publish(directory: &Path, state: &ExecutionState) -> Result<()> {
    check::identifier(&json!(state.id))?;
    if !group(&state.group)? {
        return Err(invalid("Invalid host native execution resource group"));
    }
    PrivateDirectory::open(directory, false)?.write_atomic(
        "execution.json",
        &serde_json::to_vec(&json!({"id":state.id,"group":state.group}))
            .map_err(|_| invalid("Cannot encode native execution ownership"))?,
    )
}
fn quiescent(state: &ExecutionState) -> Result<()> {
    let file = match fs::File::open(format!("/sys/fs/cgroup{}/cgroup.events", state.group)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(invalid(
                "Cannot inspect native execution resource-group state",
            ));
        }
    };
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("Cannot read native execution resource-group state"))?;
    if bytes.len() > 4096 {
        return Err(invalid(
            "Native execution resource-group state exceeds its bound",
        ));
    }
    let source =
        std::str::from_utf8(&bytes).map_err(|_| invalid("Invalid resource-group state"))?;
    let populated = source
        .lines()
        .filter(|line| line.starts_with("populated "))
        .collect::<Vec<_>>();
    match populated.as_slice() {
        ["populated 0"] => Ok(()),
        ["populated 1"] => Err(invalid(
            "A previous native execution still has live resource-group processes",
        )),
        _ => Err(invalid(
            "Cannot establish native execution resource-group state",
        )),
    }
}
pub fn require_quiescent(directory: &Path) -> Result<()> {
    if let Some(state) = read(directory)? {
        quiescent(&state)?;
    }
    Ok(())
}
// Caller retains host ownership throughout recovery and new publication.
pub fn closed_id(directory: &Path) -> Result<Option<String>> {
    let Some(state) = read(directory)? else {
        return Ok(None);
    };
    quiescent(&state)?;
    Ok(Some(state.id))
}
pub fn remove_closed(directory: &Path, id: &str) -> Result<bool> {
    let _owner = match StateLock::acquire(&directory.join("owner")) {
        Ok(owner) => owner,
        Err(error) if error.code == ErrorCode::Conflict => return Ok(false),
        Err(error) => return Err(error),
    };
    let Some(state) = read(directory)? else {
        return Ok(false);
    };
    if state.id != id {
        return Ok(false);
    }
    quiescent(&state)?;
    PrivateDirectory::open(directory, false)?.remove("execution.json")?;
    Ok(true)
}
