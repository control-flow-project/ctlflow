use crate::{configuration, container_commands as docker};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

pub const USAGE: &str = "crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR --source REPOSITORY [--port PORT] [--content-port PORT] [--compile] [--cgroup-parent EXISTING.slice]\nUses rootless Docker, a verified backup, the shared Knex migration container and the native Rust runtime. No host services or data resets.";
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
            "source",
            "port",
            "content-port",
            "compile",
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
        let value = if key == "compile" {
            "true"
        } else {
            index += 1;
            values
                .get(index)
                .map(String::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid("Missing operator option value"))?
        };
        if output.insert(key, value).is_some() {
            return Err(invalid("Repeated operator option"));
        }
        index += 1;
    }
    Ok(output)
}
fn port(value: Option<&&str>, default: u16) -> Result<u16> {
    value
        .map(|value| value.parse::<u16>().map_err(|_| invalid("Invalid port")))
        .transpose()?
        .filter(|value| *value >= 1024)
        .or_else(|| value.is_none().then_some(default))
        .ok_or_else(|| invalid("Port must be within 1024..65535"))
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
    if username.is_empty()
        || username.len() > 80
        || !username.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._=-".contains(&byte)
        })
        || *username == "conduit"
        || username.starts_with("crossfire-")
        || username.starts_with("agent-")
    {
        return Err(invalid("Supply a regular human administrator username"));
    }
    let value = json!({"instance":options.get("instance"),"serverName":options.get("server-name"),"publicOrigin":options.get("origin"),"contentOrigin":options.get("content-origin"),"matrixOrigin":"http://127.0.0.1:6167","administrator":format!("@{}:{}",username,options.get("server-name").unwrap_or(&"")),"jwtSecret":identity::secret()?.expose(),"registrationSecret":identity::secret()?.expose()});
    let parsed = configuration::parse(&value)?;
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
fn image_digest(source: &Path) -> Result<String> {
    fn add(hash: &mut Sha256, root: &Path, path: &Path) -> Result<()> {
        let information =
            std::fs::symlink_metadata(path).map_err(|_| invalid("Build input unavailable"))?;
        if information.file_type().is_symlink() {
            return Err(invalid("Build input cannot be a symbolic link"));
        }
        if information.is_dir() {
            let mut paths = std::fs::read_dir(path)
                .map_err(|_| invalid("Build directory unavailable"))?
                .map(|entry| entry.map(|entry| entry.path()))
                .collect::<std::io::Result<Vec<_>>>()
                .map_err(|_| invalid("Build inventory failed"))?;
            paths.sort();
            for path in paths {
                if ![
                    "node_modules",
                    "dist",
                    "bin",
                    "obj",
                    "target",
                    ".temp",
                    ".analysis",
                    ".git",
                ]
                .iter()
                .any(|name| path.file_name().is_some_and(|leaf| leaf == *name))
                {
                    add(hash, root, &path)?;
                }
            }
        } else if information.is_file() {
            hash.update(text(
                path.strip_prefix(root)
                    .map_err(|_| invalid("Build input escaped its root"))?,
            )?);
            let mut file =
                std::fs::File::open(path).map_err(|_| invalid("Build file unavailable"))?;
            let mut buffer = [0; 65536];
            loop {
                let count = file
                    .read(&mut buffer)
                    .map_err(|_| invalid("Build file read failed"))?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
        } else {
            return Err(invalid(
                "Build inputs must be regular files and directories",
            ));
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    for name in [
        ".dockerignore",
        ".npmrc",
        "LICENSE",
        "package.json",
        "package-lock.json",
        "tsconfig.base.json",
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain.toml",
        "services",
        "scripts",
    ] {
        add(&mut hash, source, &source.join(name))?;
    }
    Ok(format!("{:x}", hash.finalize())[..20].into())
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
    let source = absolute(
        options
            .get("source")
            .ok_or_else(|| invalid("Supply --source with the Crossfire source repository"))?,
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
    let engine = docker::captured(
        &[
            "info".into(),
            "--format".into(),
            "{{json .SecurityOptions}}".into(),
        ],
        &source,
        stop.clone(),
    )
    .await?;
    if !engine.status.success() || !engine.output.contains("rootless") {
        return Err(invalid(
            "A working rootless Docker engine is required; no host settings are changed",
        ));
    }
    let digest = image_digest(&source)?;
    let assets = format!("crossfire-assets:{digest}");
    let migrations = format!("crossfire-migrations:{digest}");
    let image = format!("crossfire-rust:{digest}");
    for (target, tag) in [("assets", &assets), ("migrations", &migrations)] {
        if options.contains_key("compile") || !docker::image(tag, &source, stop.clone()).await? {
            let mut args = vec!["build".into()];
            args.extend_from_slice(&resources);
            args.extend([
                "--file".into(),
                text(&source.join("services/crossfire/node/Dockerfile"))?.into(),
                "--target".into(),
                target.into(),
                "--tag".into(),
                tag.into(),
                text(&source)?.into(),
            ]);
            docker::run(&args, &source, stop.clone()).await?;
        }
    }
    if options.contains_key("compile") || !docker::image(&image, &source, stop.clone()).await? {
        let mut args = vec!["build".into()];
        args.extend_from_slice(&resources);
        args.extend([
            "--file".into(),
            text(&source.join("services/crossfire/rust/Dockerfile"))?.into(),
            "--build-arg".into(),
            format!("CROSSFIRE_ASSETS_IMAGE={assets}"),
            "--target".into(),
            "production".into(),
            "--tag".into(),
            image.clone(),
            text(&source)?.into(),
        ]);
        docker::run(&args, &source, stop.clone()).await?;
    }
    let name = format!("crossfire-{}", &identity::hash(text(&directory)?)[..16]);
    let existing = docker::captured(
        &[
            "container".into(),
            "inspect".into(),
            "--format".into(),
            "{{index .Config.Labels \"org.crossfire.directory\"}}".into(),
            name.clone(),
        ],
        &source,
        stop.clone(),
    )
    .await?;
    if existing.status.success() {
        if existing.output.trim() != text(&directory)? {
            return Err(invalid(
                "Existing runtime container has different ownership; nothing was stopped",
            ));
        }
        docker::run(
            &["stop".into(), "--timeout".into(), "15".into(), name.clone()],
            &source,
            stop.clone(),
        )
        .await?;
    }
    if stop.is_cancelled() {
        return Ok(());
    }
    if let Some(backup) = crossfire_adapter_sqlite::upgrade::backup_before_migration(&directory)? {
        println!("Verified pre-migration backup: {}", backup.display());
    }
    docker::owned(
        &docker::migration(text(&directory)?, &migrations, &resources),
        &source,
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
    docker::owned(
        &docker::server(
            text(&directory)?,
            &image,
            &name,
            selected,
            content,
            &resources,
        ),
        &source,
        stop,
    )
    .await
}
