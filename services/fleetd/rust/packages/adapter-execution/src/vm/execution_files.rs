use super::request::invalid;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::Result;
use std::path::PathBuf;

pub fn runtime(id: &str) -> Result<PathBuf> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    let root = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| invalid("VM execution requires the private user runtime directory"))?;
    PrivateDirectory::open(&root, false)?;
    let path = root.join(format!("cfvm-{id}"));
    if path.as_os_str().len() >= 70 {
        return Err(invalid(
            "VM runtime socket directory exceeds its Unix socket path bound",
        ));
    }
    let _checked = crossfire_adapter_process::ssh_commands::check(&path, id)?;
    Ok(path)
}
pub fn cache_root() -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| invalid("VM execution requires HOME"))?;
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cache"));
    if !cache.to_str().is_some_and(|path| {
        fleetd_contracts::configuration::absolute_path(path) && !path.chars().any(char::is_control)
    }) {
        return Err(invalid("VM cache requires an exact absolute directory"));
    }
    Ok(cache.join("ctlflow/vm"))
}
pub fn scratch(id: &str) -> Result<PathBuf> {
    crossfire_contracts::validation::identifier(&serde_json::json!(id))?;
    Ok(cache_root()?.join(id))
}
pub fn create(id: &str) -> Result<()> {
    PrivateDirectory::open(&runtime(id)?, true)?;
    PrivateDirectory::open(&scratch(id)?, true)?;
    Ok(())
}
pub fn remove(id: &str) -> Result<()> {
    for path in [scratch(id)?, runtime(id)?] {
        if !path
            .try_exists()
            .map_err(|_| invalid("Cannot inspect VM scratch directory"))?
        {
            continue;
        }
        PrivateDirectory::open(&path, false)?;
        std::fs::remove_dir_all(&path)
            .map_err(|_| invalid("Cannot remove closed VM execution files"))?;
    }
    Ok(())
}
