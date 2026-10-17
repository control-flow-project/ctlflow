use crossfire_adapter_filesystem::local_state::State;
use crossfire_agent_core::local_state::{self, LocalState};
use crossfire_contracts::validation as check;
use crossfire_kernel::Result;
use fleetd_contracts::binding;
use fleetd_domain::{binding::Binding, model::Configuration};
use serde_json::{Value, json};

pub fn load(storage: &impl LocalState, configuration: &Configuration) -> Result<Binding> {
    match local_state::read::<Value>(storage, "binding.json", 1048576)? {
        Some(value) => binding::parse(&value),
        None => Ok(Binding {
            server: configuration.roster.coordination.server.clone(),
            owner: configuration.roster.coordination.owner.clone(),
            fleet_key: configuration.roster.fleet.clone(),
            fleet_id: None,
            controller_credential: None,
            request: None,
            identities: Vec::new(),
        }),
    }
}
pub fn save(storage: &impl LocalState, selected: &Binding) -> Result<()> {
    let value = binding::value(selected);
    binding::parse(&value)?;
    local_state::write(storage, "binding.json", &value, 1048576)
}
fn history_file(agent: &str) -> Result<String> {
    check::identifier(&json!(agent))?;
    Ok(format!("history-initialization/{agent}.json"))
}
pub fn initialize(storage: &impl LocalState, agent: &str, reset: Option<&str>) -> Result<()> {
    if let Some(reset) = reset {
        check::identifier(&json!(reset))?;
    }
    local_state::write(
        storage,
        &history_file(agent)?,
        &json!({"agentId":agent,"resetId":reset}),
        1048576,
    )
}
pub fn can_initialize(storage: &impl LocalState, agent: &str) -> Result<bool> {
    let Some(value): Option<Value> = local_state::read(storage, &history_file(agent)?, 1048576)?
    else {
        return Ok(false);
    };
    let value = check::object(&value, &["agentId", "resetId"], &[])?;
    if check::identifier(&value["agentId"])? != agent {
        return Err(crossfire_kernel::Failure::new(
            crossfire_kernel::failure::ErrorCode::Conflict,
            "History initialization belongs to another enrolled identity",
        ));
    }
    if !value["resetId"].is_null() {
        check::identifier(&value["resetId"])?;
    }
    Ok(true)
}
pub fn initialized(storage: &impl LocalState, agent: &str) -> Result<()> {
    if can_initialize(storage, agent)? {
        storage.remove(&history_file(agent)?)?;
    }
    Ok(())
}
pub fn open(configuration: &Configuration) -> Result<State> {
    State::open(&configuration.directory.join(".fleet"), true)
}
