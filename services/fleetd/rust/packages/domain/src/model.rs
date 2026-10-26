use crossfire_agent_core::owned_runtime::RuntimeOptions;
use crossfire_domain::{
    coordination::Policy,
    runtime::values::{HistoryMode, Runtime},
};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Instance {
    pub key: String,
    pub name: String,
    pub definition: String,
    pub workarea: String,
    pub workspace: Option<PathBuf>,
    pub history_mode: Option<HistoryMode>,
    pub mirror_output: Option<bool>,
    pub runtime_options: Option<RuntimeOptions>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coordination {
    pub server: String,
    pub owner: String,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Roster {
    pub fleet: String,
    pub coordination: Coordination,
    pub instances: Vec<Instance>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Definition {
    pub name: String,
    pub runtime: Runtime,
    pub options: RuntimeOptions,
    pub instructions: String,
    pub coordination_policy: Policy,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Configuration {
    pub directory: PathBuf,
    pub roster: Roster,
    pub definitions: BTreeMap<String, Definition>,
    pub digest: String,
}
impl Configuration {
    pub fn native_options(&self, instance: &Instance) -> crossfire_kernel::Result<RuntimeOptions> {
        let definition = self.definitions.get(&instance.definition).ok_or_else(|| {
            crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Invalid,
                "Instance references an unavailable role definition",
            )
        })?;
        let mut options = definition.options.clone();
        if let Some(overrides) = &instance.runtime_options {
            options.extend(overrides.clone());
        }
        Ok(options)
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub fleet_id: String,
    pub fleet_key: String,
    pub directory: PathBuf,
    pub label: String,
    pub revision: i64,
    pub digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct DesiredIntent {
    pub fleet_id: String,
    pub instance_key: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeSelection {
    pub fleet_id: String,
    pub instance_keys: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterruptedContext {
    pub context: String,
    pub session_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumeWork {
    pub context: String,
    pub session_id: String,
    pub message_id: String,
    pub checkpointed_at: i64,
}
