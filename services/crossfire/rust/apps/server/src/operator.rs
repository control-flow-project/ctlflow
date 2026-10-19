use crate::{configuration, container_commands as docker, container_lifecycle, container_package};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

pub const USAGE: &str = "crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR --package PACKAGE_DIR [--port PORT] [--content-port PORT] [--cgroup-parent EXISTING.slice]\nUses rootless Docker, a verified package and backup, and the shared Knex migration container. The package selects the backend without a source checkout. No host services or data resets.";
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| invalid("Paths must be valid Unicode"))
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
        Some("start") => &[
            "directory",
            "package",
            "port",
            "content-port",
            "cgroup-parent",
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
fn port(value: Option<&&str>, default: u16) -> Result<u16> {
    let failed = || invalid("Port must be a canonical decimal integer within 1024..65535");
    let selected = match value {
        Some(value)
            if matches!(value.len(), 4 | 5)
                && value.as_bytes()[0] != b'0'
                && value.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            value.parse::<u16>().map_err(|_| failed())?
        }
        Some(_) => return Err(failed()),
        None => default,
    };
    if selected < 1024 {
        return Err(failed());
    }
    Ok(selected)
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
pub async fn run(values: &[String], stop: CancellationToken) -> Result<()> {
    let options = parse(values)?;
    let directory = absolute(
        options
            .get("directory")
            .ok_or_else(|| invalid("Supply --directory"))?,
    )?;
    if values[0] == "init" {
        return initialize(&directory, &options);
    }
    PrivateDirectory::open(&directory, false)?;
    let config = configuration::load(&directory)?;
    let package = absolute(
        options
            .get("package")
            .ok_or_else(|| invalid("Supply an explicit --package directory"))?,
    )?;
    let selected = port(
        options.get("port"),
        config.public_origin.port().unwrap_or(8080),
    )?;
    let content = port(options.get("content-port"), 8082)?;
    if selected == content {
        return Err(invalid("Content and application ports must differ"));
    }
    let resources = docker::resources(options.get("cgroup-parent").copied())?;
    let _ownership = StateLock::acquire(&directory.join("operator"))?;
    let engine = docker::captured(
        &[
            "info".into(),
            "--format".into(),
            "{{json .SecurityOptions}}".into(),
        ],
        &directory,
        stop.clone(),
    )
    .await?;
    if !engine.status.success() || !engine.output.contains("rootless") {
        return Err(invalid(
            "A working rootless Docker engine is required; no host settings are changed",
        ));
    }
    let selected_package = container_package::prepare(&package, &directory, stop.clone()).await?;
    let [name, _migration] = container_lifecycle::names(text(&directory)?);
    container_lifecycle::reconcile(text(&directory)?, &directory, stop.clone()).await?;
    if stop.is_cancelled() {
        return Ok(());
    }
    if let Some(backup) = crossfire_adapter_sqlite::upgrade::backup_before_migration(&directory)? {
        println!("Verified pre-migration backup: {}", backup.display());
    }
    container_lifecycle::owned(
        &docker::migration(
            text(&directory)?,
            &selected_package.migration_image,
            &resources,
        ),
        &directory,
        stop.clone(),
    )
    .await?;
    if stop.is_cancelled() {
        return Ok(());
    }
    println!(
        "Public: {}\nManagement: {}manage/\nContent: {}",
        config.public_origin, config.public_origin, config.content_origin
    );
    container_lifecycle::owned(
        &docker::server(
            text(&directory)?,
            &selected_package.runtime_image,
            &name,
            selected,
            content,
            &resources,
        ),
        &directory,
        stop,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::port;

    #[test]
    fn configured_port_defaults_obey_the_same_bounds_as_explicit_options() {
        for selected in [0, 1, 80, 443, 1023] {
            assert!(port(None, selected).is_err(), "invalid default {selected}");
        }
        for selected in [1024, 8080, 65535] {
            assert_eq!(port(None, selected).ok(), Some(selected));
            let text = selected.to_string();
            assert_eq!(port(Some(&text.as_str()), 8080).ok(), Some(selected));
        }
    }
}
