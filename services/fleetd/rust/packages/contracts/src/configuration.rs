use crossfire_contracts::validation as check;
use crossfire_domain::{
    coordination::{BackendSender, Policy},
    identity::WakeMode,
    runtime::values::{HistoryMode, Runtime},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::model::*;
use serde_json::Value;
use std::{collections::BTreeSet, path::PathBuf};

pub fn options(value: &Value) -> Result<crossfire_agent_core::owned_runtime::RuntimeOptions> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected runtime options"))
}
pub fn relative_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && !segment.starts_with('.') && segment != "..")
}
pub fn absolute_path(value: &str) -> bool {
    value.starts_with('/')
        && !value.contains('\\')
        && value
            .split('/')
            .skip(1)
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
pub fn instance(value: &Value) -> Result<Instance> {
    let value = check::object(
        value,
        &["key", "name", "definition", "workarea"],
        &["workspace", "listener_options", "runtime_options"],
    )?;
    let workspace = value
        .get("workspace")
        .map(|value| {
            let value = check::text(value, 1, 4096)?;
            if !absolute_path(value) {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Workspace must be an absolute normalized directory",
                ));
            }
            Ok(PathBuf::from(value))
        })
        .transpose()?;
    let history_mode = value
        .get("listener_options")
        .map(|value| {
            let value = check::object(value, &[], &["history_mode"])?;
            value
                .get("history_mode")
                .map(|value| HistoryMode::parse(check::text(value, 1, 20)?))
                .transpose()
        })
        .transpose()?
        .flatten();
    Ok(Instance {
        key: check::name(&value["key"])?.to_owned(),
        name: check::name(&value["name"])?.to_owned(),
        definition: check::name(&value["definition"])?.to_owned(),
        workarea: check::text(&value["workarea"], 1, 1024)?.to_owned(),
        workspace,
        history_mode,
        runtime_options: value.get("runtime_options").map(options).transpose()?,
    })
}
pub fn api_instance(value: &Value) -> Result<Instance> {
    let source = check::object(
        value,
        &["key", "name", "definition", "workarea"],
        &["workspace", "listenerOptions", "runtimeOptions"],
    )?;
    let mut canonical = source.clone();
    if let Some(options) = canonical.remove("runtimeOptions") {
        canonical.insert("runtime_options".to_owned(), options);
    }
    if let Some(options) = canonical.remove("listenerOptions") {
        let options = check::object(&options, &[], &["historyMode"])?;
        canonical.insert(
            "listener_options".to_owned(),
            options
                .iter()
                .map(|(key, value)| {
                    (
                        if key == "historyMode" {
                            "history_mode".to_owned()
                        } else {
                            key.clone()
                        },
                        value.clone(),
                    )
                })
                .collect(),
        );
    }
    instance(&Value::Object(canonical))
}
pub fn roster(value: &Value) -> Result<Roster> {
    let value = check::object(value, &["fleet", "coordination", "instances"], &[])?;
    let coordination = check::object(&value["coordination"], &["adapter", "server", "owner"], &[])?;
    check::choice(&coordination["adapter"], &["crossfire"])?;
    let server = check::text(&coordination["server"], 1, 2048)?;
    let url = url::Url::parse(server)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid Crossfire origin"))?;
    let loopback = [Some("localhost"), Some("127.0.0.1"), Some("[::1]")].contains(&url.host_str());
    if url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.scheme() != "https" && !(url.scheme() == "http" && loopback)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Use an HTTPS origin or loopback HTTP",
        ));
    }
    let instances = check::list(&value["instances"], 0, 100)?
        .iter()
        .map(instance)
        .collect::<Result<Vec<_>>>()?;
    for label in ["key", "name", "workarea"] {
        let values: BTreeSet<_> = instances
            .iter()
            .map(|instance| match label {
                "key" => &instance.key,
                "name" => &instance.name,
                _ => &instance.workarea,
            })
            .collect();
        if values.len() != instances.len() {
            return Err(Failure::new(
                ErrorCode::Invalid,
                format!("Duplicate instance {label}"),
            ));
        }
    }
    for current in &instances {
        let segments: Vec<_> = current.workarea.split('/').collect();
        if !relative_path(&current.workarea)
            || segments.len() < 4
            || segments[0] != "agents"
            || segments[2] != "workarea"
            || check::name(&Value::String(segments[1].to_owned())).is_err()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Work areas must be relative children of agents/<definition>/workarea",
            ));
        }
        if instances.iter().any(|other| {
            other.key != current.key
                && other
                    .workarea
                    .starts_with(&format!("{}/", current.workarea))
        }) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Instance work areas cannot overlap",
            ));
        }
    }
    Ok(Roster {
        fleet: check::name(&value["fleet"])?.to_owned(),
        coordination: Coordination {
            server: server.to_owned(),
            owner: check::backend_user_id(&coordination["owner"])?.to_owned(),
        },
        instances,
    })
}
pub fn definition(value: &Value, instructions: String, owner: &str) -> Result<Definition> {
    let value = check::object(
        value,
        &["name", "runtime", "runtime_options"],
        &["coordination_options"],
    )?;
    let coordination_policy = match value.get("coordination_options") {
        None => Policy::owner_default(owner),
        Some(policy) => {
            let policy = check::object(policy, &["wake_mode", "wake_senders", "permissions"], &[])?;
            let mode =
                match check::choice(&policy["wake_mode"], &["humans", "everyone", "selected"])? {
                    "humans" => WakeMode::Humans,
                    "everyone" => WakeMode::Everyone,
                    _ => WakeMode::Selected,
                };
            let senders = check::list(&policy["wake_senders"], 0, 2000)?
                .iter()
                .map(|value| {
                    let value = check::object(value, &["backend_user_id", "include_agents"], &[])?;
                    Ok(BackendSender {
                        backend_user_id: check::backend_user_id(&value["backend_user_id"])?
                            .to_owned(),
                        include_agents: check::boolean(&value["include_agents"])?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            let permissions = check::list(&policy["permissions"], 0, 1)?;
            for value in permissions {
                check::choice(value, &["room.agent.invite"])?;
            }
            if mode == WakeMode::Everyone && !senders.is_empty()
                || senders
                    .iter()
                    .map(|sender| &sender.backend_user_id)
                    .collect::<BTreeSet<_>>()
                    .len()
                    != senders.len()
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Select unique identities; everyone requires no individual selections",
                ));
            }
            Policy {
                mode,
                senders,
                invite_agents: !permissions.is_empty(),
            }
        }
    };
    Ok(Definition {
        name: check::text(&value["name"], 1, 100)?.to_owned(),
        runtime: Runtime::parse(check::text(&value["runtime"], 1, 100)?)?,
        options: options(&value["runtime_options"])?,
        instructions,
        coordination_policy,
    })
}
