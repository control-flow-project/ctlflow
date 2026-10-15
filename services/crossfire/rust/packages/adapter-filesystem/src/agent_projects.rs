use crate::PrivateDirectory;
use crossfire_contracts::validation;
use crossfire_kernel::Result;
use serde_json::json;
use std::path::{Path, PathBuf};

pub struct Paths {
    pub workspace: PathBuf,
    pub root: PathBuf,
    pub profile: PathBuf,
    pub state: PathBuf,
    pub cursors: PathBuf,
}
pub fn paths(project: &Path, profile: &str) -> Result<Paths> {
    validation::name(&json!(profile))?;
    let project_directory = PrivateDirectory::open(project, true)?;
    let integration = project_directory.child(".crossfire", true)?;
    integration.child("profiles", true)?;
    integration.child("state", true)?.child(profile, true)?;
    let root = project.join(".crossfire");
    let state = root.join("state").join(profile);
    Ok(Paths {
        workspace: project.to_owned(),
        profile: root.join("profiles").join(format!("{profile}.json")),
        cursors: state.join("cursors.json"),
        root,
        state,
    })
}
