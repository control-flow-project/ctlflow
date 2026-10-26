use crate::configuration;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub const USAGE: &str = "crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\nInitializes private configuration only. Use Docker Compose with the matching one-shot migration image for deployment.";
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn absolute(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|_| invalid("Working directory unavailable"))?
            .join(path)
    };
    let mut output = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                output.pop();
            }
            part => output.push(part),
        }
    }
    Ok(output)
}
fn parse(values: &[String]) -> Result<BTreeMap<&str, &str>> {
    let allowed = match values.first().map(String::as_str) {
        Some("init") => &[
            "directory",
            "instance",
            "origin",
            "content-origin",
            "server-name",
            "administrator",
        ][..],
        _ => return Err(invalid(USAGE)),
    };
    let mut output = BTreeMap::new();
    let mut index = 1;
    while index < values.len() {
        let key = values[index]
            .strip_prefix("--")
            .filter(|key| allowed.contains(key))
            .ok_or_else(|| invalid("Invalid operator option"))?;
        index += 1;
        let value = values
            .get(index)
            .map(String::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid(&format!("Duplicated or empty option --{key}")))?;
        if output.insert(key, value).is_some() {
            return Err(invalid(&format!("Duplicated option --{key}")));
        }
        index += 1;
    }
    Ok(output)
}
fn initialize(directory: &Path, options: &BTreeMap<&str, &str>) -> Result<()> {
    match std::fs::symlink_metadata(directory) {
        Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
            return Err(invalid(
                "Initialization requires an empty non-symlink directory",
            ));
        }
        Ok(_) => {
            if std::fs::read_dir(directory)
                .map_err(|_| invalid("Cannot inspect initialization directory"))?
                .next()
                .is_some()
            {
                return Err(invalid("Initialization never overwrites existing data"));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(invalid("Cannot inspect initialization directory")),
    }
    let username = options
        .get("administrator")
        .ok_or_else(|| invalid("Supply --administrator"))?;
    let administrator = crossfire_adapter_matrix::settings::administrator_user(
        username,
        options.get("server-name").unwrap_or(&""),
    )?;
    let value = json!({"instance":options.get("instance"),"publicOrigin":options.get("origin"),"contentOrigin":options.get("content-origin"),"administrator":administrator,"messaging":{"type":"matrix","parameters":{"serverName":options.get("server-name"),"origin":"http://127.0.0.1:6167","jwtSecret":identity::secret()?.expose(),"registrationSecret":identity::secret()?.expose()}}});
    let parsed = configuration::parse(&value)?;
    crossfire_adapter_matrix::settings::read(
        &parsed.messaging,
        &parsed.instance,
        &parsed.administrator,
    )?;
    let private = PrivateDirectory::open(directory, true)?;
    private.write_atomic(
        "config.json",
        &serde_json::to_vec_pretty(&value).map_err(|_| invalid("Cannot encode configuration"))?,
    )?;
    private.write_atomic("bootstrap.json",&serde_json::to_vec_pretty(&json!({"servicePassword":identity::secret()?.expose(),"administratorPassword":identity::secret()?.expose()})).map_err(|_|invalid("Cannot encode credentials"))?)?;
    println!(
        "Initialized {}\nAdministrator: {}\nInitial password: administratorPassword in {}",
        directory.display(),
        parsed.administrator,
        directory.join("bootstrap.json").display()
    );
    Ok(())
}
pub fn run(values: &[String]) -> Result<()> {
    let options = parse(values)?;
    let directory = absolute(
        options
            .get("directory")
            .ok_or_else(|| invalid("Supply --directory"))?,
    )?;
    initialize(&directory, &options)
}
