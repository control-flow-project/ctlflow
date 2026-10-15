use crossfire_adapter_codex::context_migration;
use crossfire_adapter_filesystem::{agent_projects, lock::StateLock};
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::Result;
use fleetd_storage::{configuration, registry::Registry};
use std::path::Path;

pub async fn run(_root: &Path, registry: &Registry) -> Result<()> {
    let mut ownership = vec![];
    let mut inputs = vec![];
    for registration in registry.registrations()? {
        let configuration = configuration::load(&registration.directory, None)?;
        for instance in &configuration.roster.instances {
            if configuration.definitions[&instance.definition].runtime != Runtime::Codex {
                continue;
            }
            let state = configuration.directory.join(&instance.workarea);
            if !state.exists() {
                continue;
            }
            let paths = agent_projects::paths(&state, &instance.key)?;
            for name in ["listener", "receiver"] {
                ownership.push(StateLock::acquire(&paths.state.join(name))?);
            }
            inputs.push((
                instance.workspace.clone().unwrap_or_else(|| state.clone()),
                state,
            ));
        }
    }
    let mut migrated = 0;
    let mut contexts = 0;
    for (workspace, state) in &inputs {
        let outcome = context_migration::run(workspace, state)?;
        migrated += usize::from(outcome.migrated);
        contexts += outcome.contexts;
    }
    println!(
        "{}",
        serde_json::json!({"status":"migrated","inspected":inputs.len(),"migrated":migrated,"contexts":contexts})
    );
    drop(ownership);
    Ok(())
}
