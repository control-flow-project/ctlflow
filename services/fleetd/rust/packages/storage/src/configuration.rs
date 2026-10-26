use crossfire_adapter_filesystem::owned::{DirectoryAccess, OwnedFile, validate_directory};
use crossfire_adapter_toml::{self as toml, Value as Toml};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_contracts::configuration as check;
use fleetd_domain::model::{Configuration, Roster};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

pub fn text(path: &Path, maximum: usize) -> Result<String> {
    let file = OwnedFile::open(path, maximum as u64)?.ok_or_else(|| {
        Failure::new(ErrorCode::Missing, "A required fleet input file is missing")
    })?;
    String::from_utf8(file.configuration(maximum)?)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Fleet instructions must be valid UTF-8"))
}
pub fn json_value(value: Toml) -> Result<Value> {
    Ok(match value {
        Toml::String(value) => Value::String(value),
        Toml::Integer(value) => json!(value),
        Toml::Boolean(value) => json!(value),
        Toml::Float(value) => {
            Value::Number(serde_json::Number::from_f64(value).ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Nonfinite native options cannot be represented by the runtime protocol",
                )
            })?)
        }
        Toml::Array(values) => {
            Value::Array(values.into_iter().map(json_value).collect::<Result<_>>()?)
        }
        Toml::Table(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| Ok((key, json_value(value)?)))
                .collect::<Result<_>>()?,
        ),
        Toml::Datetime(value) => {
            let mut text = String::new();
            if let Some(date) = value.date {
                text.push_str(&format!(
                    "{:04}-{:02}-{:02}",
                    date.year, date.month, date.day
                ));
            }
            if let Some(time) = value.time {
                if value.date.is_some() {
                    text.push('T');
                }
                text.push_str(&format!(
                    "{:02}:{:02}:{:02}.{:03}",
                    time.hour,
                    time.minute,
                    time.second.unwrap_or(0),
                    time.nanosecond.unwrap_or(0) / 1_000_000
                ));
            }
            if let Some(offset) = value.offset {
                text.push_str(&offset.to_string());
            }
            Value::String(text)
        }
    })
}
fn parse(source: &str) -> Result<Value> {
    json_value(Toml::Table(toml::parse(source.as_bytes())?))
}
pub fn load(directory: &Path, replacement: Option<&str>) -> Result<Configuration> {
    validate_directory(directory, DirectoryAccess::Configuration)
        .map_err(|error| error.field("fleetDirectory"))?;
    let source = match replacement {
        Some(value) => value.to_owned(),
        None => text(&directory.join("runtime.toml"), 1024 * 1024)
            .map_err(|error| error.field("runtimeConfiguration"))?,
    };
    let roster = check::roster(&parse(&source)?)?;
    let mut digest = Sha256::new();
    digest.update(source.as_bytes());
    let setup = match OwnedFile::open(
        &directory.join(".fleet/setup-instructions.json"),
        256 * 1024,
    )? {
        None => String::new(),
        Some(file) => {
            file.private_permissions()?;
            let value: Value =
                serde_json::from_slice(&file.configuration(256 * 1024)?).map_err(|_| {
                    Failure::new(ErrorCode::Invalid, "Invalid private setup instructions")
                })?;
            let value = crossfire_contracts::validation::object(&value, &["instructions"], &[])?;
            crossfire_contracts::validation::plain_text(&value["instructions"], 128 * 1024)?
                .to_owned()
        }
    };
    digest.update(setup.as_bytes());
    let mut definitions = BTreeMap::new();
    for instance in &roster.instances {
        if !definitions.contains_key(&instance.definition) {
            let root = directory.join("agents").join(&instance.definition);
            let role = text(&root.join("agent.toml"), 1024 * 1024)
                .map_err(|error| error.field("roleConfiguration"))?;
            let instructions = text(&root.join("AGENTS.md"), 128 * 1024)
                .map_err(|error| error.field("roleInstructions"))?;
            let combined = [&instructions, &setup]
                .into_iter()
                .filter(|value| !value.is_empty())
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join("\n\n");
            let definition =
                check::definition(&parse(&role)?, combined, &roster.coordination.owner)?;
            digest.update(instance.definition.as_bytes());
            digest.update(role.as_bytes());
            digest.update(instructions.as_bytes());
            definitions.insert(instance.definition.clone(), definition);
        }
        if let Some(workspace) = &instance.workspace {
            validate_directory(workspace, DirectoryAccess::Workspace)?;
        }
        let mut path = directory.to_path_buf();
        for segment in instance.workarea.split('/') {
            path.push(segment);
            match std::fs::symlink_metadata(&path) {
                Ok(_) => validate_directory(&path, DirectoryAccess::Configuration)
                    .map_err(|error| error.field("workarea"))?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(_) => {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Cannot inspect a declared native work area",
                    ));
                }
            }
        }
    }
    Ok(Configuration {
        directory: directory.to_owned(),
        roster,
        definitions,
        digest: format!("{:x}", digest.finalize()),
    })
}
pub fn roster_wire(roster: &Roster) -> Value {
    json!({ "fleet":roster.fleet,"coordination":{"adapter":"crossfire","server":roster.coordination.server,"owner":roster.coordination.owner},
        "instances":roster.instances.iter().map(|instance| {
            let mut value = json!({"key":instance.key,"name":instance.name,"definition":instance.definition,"workarea":instance.workarea});
            if let Some(workspace) = &instance.workspace { value["workspace"] = json!(workspace); }
            if instance.history_mode.is_some() || instance.mirror_output.is_some() {
                value["listener_options"] = json!({});
                if let Some(mode) = instance.history_mode { value["listener_options"]["history_mode"] = json!(mode.code()); }
                if let Some(mirror) = instance.mirror_output { value["listener_options"]["mirror_output"] = json!(mirror); }
            }
            if let Some(options) = &instance.runtime_options { value["runtime_options"] = json!(options); }
            value
        }).collect::<Vec<_>>() })
}
pub fn toml_value(value: &Value) -> Result<Toml> {
    Ok(match value {
        Value::String(value) => Toml::String(value.clone()),
        Value::Bool(value) => Toml::Boolean(*value),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Toml::Integer(integer)
            } else {
                Toml::Float(value.as_f64().ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Invalid,
                        "Native configuration number cannot be represented as TOML",
                    )
                })?)
            }
        }
        Value::Array(values) => Toml::Array(values.iter().map(toml_value).collect::<Result<_>>()?),
        Value::Object(values) => Toml::Table(
            values
                .iter()
                .map(|(key, value)| Ok((key.clone(), toml_value(value)?)))
                .collect::<Result<_>>()?,
        ),
        Value::Null => {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "TOML cannot represent null configuration values",
            ));
        }
    })
}
pub fn format(value: &Value) -> Result<String> {
    let Toml::Table(table) = toml_value(value)? else {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Configuration must be a TOML table",
        ));
    };
    toml::format(&table)
}
pub fn write_roster(configuration: &Configuration, roster: &Roster) -> Result<Configuration> {
    let source = format(&roster_wire(roster))?;
    let validated = load(&configuration.directory, Some(&source))?;
    if load(&configuration.directory, None)?.digest != configuration.digest {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Fleet files changed during a roster update; no configuration was replaced",
        ));
    }
    crossfire_adapter_filesystem::owned::write_configuration(
        &configuration.directory.join("runtime.toml"),
        source.as_bytes(),
        1048576,
    )?;
    Ok(validated)
}
