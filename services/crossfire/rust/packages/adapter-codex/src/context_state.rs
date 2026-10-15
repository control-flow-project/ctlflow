use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::journal;
use crossfire_agent_core::owned_runtime::SavedContext;
use crossfire_contracts::validation;
use crossfire_domain::runtime::values::HistoryMode;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

pub const REGISTRY: &str = "crossfire-context-registry.json";
pub const MAXIMUM_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub context: String,
    pub session_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub mode: String,
    pub bindings: Vec<Binding>,
}

pub fn validate_context(context: &str) -> Result<()> {
    if ["shared", "control"].contains(&context) {
        Ok(())
    } else {
        validation::room_id(&json!(context)).map(|_| ())
    }
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

impl Registry {
    pub fn mode(&self) -> Result<HistoryMode> {
        HistoryMode::parse(&self.mode)
    }
    pub fn validate(&self) -> Result<()> {
        self.mode()?;
        if self.bindings.len() > 2002 {
            return Err(invalid("Native history room budget is exhausted"));
        }
        let mut contexts = HashSet::new();
        let mut sessions = HashSet::new();
        for binding in &self.bindings {
            validate_context(&binding.context)?;
            validation::identifier(&json!(binding.session_id))?;
            if !contexts.insert(&binding.context) || !sessions.insert(&binding.session_id) {
                return Err(invalid(
                    "Native history bindings require unique rooms and distinct session identities",
                ));
            }
        }
        Ok(())
    }
    pub fn session(&self, context: &str) -> Option<&str> {
        self.bindings
            .iter()
            .find(|value| value.context == context)
            .map(|value| value.session_id.as_str())
    }
    pub fn add(&mut self, context: &str, session: &str, mode: HistoryMode) -> Result<()> {
        validate_context(context)?;
        validation::identifier(&json!(session))?;
        if self
            .bindings
            .iter()
            .any(|value| value.context == context || value.session_id == session)
        {
            return Err(invalid("Native runtime reused another history identity"));
        }
        if !["shared", "control"].contains(&context)
            && self
                .bindings
                .iter()
                .filter(|value| !["shared", "control"].contains(&value.context.as_str()))
                .count()
                >= 2000
        {
            return Err(invalid("Native room history budget is exhausted"));
        }
        self.mode = mode.code().to_owned();
        self.bindings.push(Binding {
            context: context.to_owned(),
            session_id: session.to_owned(),
        });
        self.validate()
    }
}

pub fn receipt(home: &Path, context: &str) -> PathBuf {
    home.join(format!("{REGISTRY}.{}.receipt", journal::digest(context)))
}

pub(crate) fn obsolete(name: &str) -> bool {
    name == "crossfire-session.json"
        || name.starts_with("crossfire-session.json.")
        || name == "crossfire-contexts.json"
        || name.starts_with("crossfire-contexts.json.")
}

pub fn load(home: &Path) -> Result<(Registry, bool)> {
    let directory = PrivateDirectory::open(home, false)?;
    if directory.names(20_000)?.iter().any(|name| obsolete(name)) {
        return Err(invalid(
            "Native context metadata requires the explicit fleetd context migration before resume",
        ));
    }
    crate::context_migration::validate_completed(home)?;
    let bytes = directory.read_optional(REGISTRY, MAXIMUM_BYTES)?;
    let exists = bytes.is_some();
    let registry = match bytes {
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid native context registry"))?,
        None => Registry {
            mode: "shared".to_owned(),
            bindings: Vec::new(),
        },
    };
    registry.validate()?;
    Ok((registry, exists))
}

pub fn save(home: &Path, registry: &Registry) -> Result<()> {
    registry.validate()?;
    PrivateDirectory::open(home, false)?.write_atomic(
        REGISTRY,
        &serde_json::to_vec(registry).map_err(|_| invalid("Invalid native history binding"))?,
    )
}

pub fn saved(home: &Path, workspace: &Path) -> Result<Vec<SavedContext>> {
    match std::fs::symlink_metadata(home) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(invalid("Cannot inspect the owned native history directory")),
        Ok(_) => {}
    }
    Ok(load(home)?
        .0
        .bindings
        .into_iter()
        .map(|binding| SavedContext {
            context: binding.context,
            session_id: binding.session_id,
            runtime: "codex".to_owned(),
            workspace: workspace.to_owned(),
        })
        .collect())
}

pub fn reset(home: &Path, id: &str) -> Result<()> {
    validation::identifier(&json!(id))?;
    load(home)?;
    let directory = PrivateDirectory::open(home, false)?;
    if let Some(bytes) = directory.read_optional("crossfire-reset.json", 1024)? {
        let marker: Value =
            serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid native reset identity"))?;
        validation::object(&marker, &["resetId"], &[])?;
        validation::identifier(&marker["resetId"])?;
        if marker["resetId"] == id {
            return Ok(());
        }
    }
    let archive = PrivateDirectory::open(&home.join("crossfire-archive").join(id), true)?;
    for name in directory
        .names(20_000)?
        .into_iter()
        .filter(|name| name == REGISTRY || name.starts_with(&(REGISTRY.to_owned() + ".")))
    {
        directory.move_entry(&name, &archive)?;
    }
    directory.write_atomic(
        "crossfire-reset.json",
        &serde_json::to_vec(&json!({"resetId":id}))
            .map_err(|_| invalid("Invalid native reset marker"))?,
    )
}
