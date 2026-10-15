use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_runtime::{
    history::{self, Boundary},
    journal,
};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub context: String,
    pub file: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub session_id: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub instructions_digest: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub mode: String,
    pub bindings: Vec<Binding>,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn allocate(context: &str) -> Result<Binding> {
    validation::text(&json!(context), 1, 255)?;
    Ok(Binding {
        context: context.to_owned(),
        file: journal::digest(context) + ".jsonl",
        session_id: None,
        instructions_digest: None,
    })
}
pub fn history(home: &Path, binding: &Binding) -> PathBuf {
    home.join("histories").join(&binding.file)
}
impl Registry {
    pub fn validate(&self) -> Result<()> {
        if !["shared", "per-room"].contains(&self.mode.as_str()) || self.bindings.len() > 2002 {
            return Err(invalid("Invalid canonical Pi context registry"));
        }
        let mut contexts = HashSet::new();
        let mut files = HashSet::new();
        let mut sessions = HashSet::new();
        for binding in &self.bindings {
            if allocate(&binding.context)?.file != binding.file
                || !contexts.insert(&binding.context)
                || !files.insert(&binding.file)
            {
                return Err(invalid("Duplicate or invalid canonical Pi context binding"));
            }
            if let Some(session) = &binding.session_id {
                validation::identifier(&json!(session))?;
                if !sessions.insert(session) {
                    return Err(invalid(
                        "Pi histories require distinct native session identities",
                    ));
                }
            }
            if let Some(digest) = &binding.instructions_digest
                && (digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value)))
            {
                return Err(invalid("Invalid native Pi instruction digest"));
            }
        }
        Ok(())
    }
}
pub fn load(home: &Path) -> Result<(Registry, bool)> {
    let bytes = PrivateDirectory::open(home, false)?
        .read_optional("crossfire-contexts.json", 4 * 1024 * 1024)?;
    let exists = bytes.is_some();
    let registry = match bytes {
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Invalid canonical Pi context registry"))?,
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
        "crossfire-contexts.json",
        &serde_json::to_vec(registry)
            .map_err(|_| invalid("Invalid canonical Pi context registry"))?,
    )
}
pub fn verify(file: &Path, workspace: &Path, session: &str) -> Result<()> {
    let header = history::header(file)?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Missing,
            "Saved Pi history is missing; resume cannot create a different history",
        )
    })?;
    if header["type"] != "session"
        || header["id"] != session
        || header["cwd"].as_str() != workspace.to_str()
        || header["version"] != 3
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Pi history identity, workspace or native format changed",
        ));
    }
    Ok(())
}
pub fn read_binding(home: &Path, binding: &mut Binding, workspace: &Path) -> Result<()> {
    let file = history(home, binding);
    if let Some(session) = &binding.session_id {
        return verify(&file, workspace, session);
    }
    let Some(opened) = OwnedFile::open(&file, u64::MAX)? else {
        return Ok(());
    };
    opened.private_permissions()?;
    if opened.information()?.size == 0 {
        return Ok(());
    }
    let header = history::header(&file)?
        .ok_or_else(|| invalid("Allocated Pi history has no complete native header"))?;
    let id = validation::identifier(&header["id"])?;
    verify(&file, workspace, id)?;
    binding.session_id = Some(id.to_owned());
    Ok(())
}
pub fn initialize(home: &Path, binding: &mut Binding, workspace: &Path) -> Result<()> {
    if binding.session_id.is_some() {
        return read_binding(home, binding, workspace);
    }
    let directory = PrivateDirectory::open(&home.join("histories"), true)?;
    if OwnedFile::open(&history(home, binding), u64::MAX)?.is_none() {
        directory.write_new(&binding.file, &[])?;
    }
    read_binding(home, binding, workspace)
}
pub fn verify_instructions(
    file: &Path,
    digest: &str,
    text: &str,
    since: Option<&Boundary>,
    entry_id: &str,
) -> Result<()> {
    let mut matched = false;
    history::since(file, since, |entry| {
        if entry["type"] == "custom"
            && entry["id"] == entry_id
            && entry["customType"] == "crossfire-instructions"
        {
            matched = entry["data"]["digest"] == digest && entry["data"]["text"] == text;
        }
        Ok(())
    })?;
    if !matched {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Pi did not persist the exact instruction receipt",
        ));
    }
    OwnedFile::open(file, u64::MAX)?
        .ok_or_else(|| invalid("Native Pi history disappeared"))?
        .secure_and_sync()
}
