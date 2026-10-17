use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock, owned::OwnedFile};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use serde::{Deserialize, Deserializer};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid or unsafe fleetd configuration; expected schemaVersion 1 and a private 256-bit authenticationKey",
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Settings {
    schema_version: serde_json::Value,
    #[serde(default, deserialize_with = "selected_key")]
    authentication_key: Option<String>,
}
fn selected_key<'de, Decoder: Deserializer<'de>>(
    decoder: Decoder,
) -> std::result::Result<Option<String>, Decoder::Error> {
    String::deserialize(decoder).map(Some)
}
pub fn decode(bytes: &[u8]) -> Result<Option<Secret>> {
    if bytes.len() > 4096 {
        return Err(invalid());
    }
    let settings: Settings = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    crossfire_contracts::validation::integer(&settings.schema_version, 1, 1)
        .map_err(|_| invalid())?;
    match settings.authentication_key {
        None => Ok(None),
        Some(key)
            if key.len() == 64
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) =>
        {
            Ok(Some(Secret::new(key)))
        }
        _ => Err(invalid()),
    }
}

pub fn configuration_root(platform: &str, home: &Path, xdg: Option<&Path>) -> Result<PathBuf> {
    let root = match platform {
        "darwin" => home.join("Library/Application Support"),
        "linux" => xdg.map_or_else(|| home.join(".config"), Path::to_path_buf),
        _ => return Err(invalid()),
    };
    for path in [home, root.as_path()] {
        if !path.is_absolute()
            || path.components().any(|part| {
                matches!(
                    part,
                    std::path::Component::CurDir | std::path::Component::ParentDir
                )
            })
            || path.components().collect::<PathBuf>().as_os_str() != path.as_os_str()
        {
            return Err(invalid());
        }
    }
    Ok(root)
}

pub fn configuration_directory(platform: &str, home: &Path, xdg: Option<&Path>) -> Result<PathBuf> {
    configuration_root(platform, home, xdg).map(|root| root.join("ctlflow"))
}
pub fn root() -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(invalid)?;
    let xdg = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
    configuration_root(
        if cfg!(target_os = "macos") {
            "darwin"
        } else {
            std::env::consts::OS
        },
        &home,
        xdg.as_deref(),
    )
}

pub fn file_path() -> Result<PathBuf> {
    root().map(|path| path.join("ctlflow/fleetd.json"))
}

fn settings(path: &Path) -> Result<Option<Secret>> {
    let Some(file) = OwnedFile::open(path, 4096).map_err(|_| invalid())? else {
        return Ok(None);
    };
    file.private_permissions().map_err(|_| invalid())?;
    let parent =
        PrivateDirectory::open(path.parent().ok_or_else(invalid)?, false).map_err(|_| invalid())?;
    let bytes = parent
        .read_optional(
            path.file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(invalid)?,
            4096,
        )
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    decode(&bytes)
}

pub fn read(path: &Path) -> Result<Secret> {
    settings(path)?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Unauthorized,
            "Fleetd authentication key is missing; start fleetd to initialize its configuration",
        )
    })
}

pub async fn initialize(path: &Path) -> Result<Secret> {
    if let Some(key) = settings(path)? {
        return Ok(key);
    }
    let parent = PrivateDirectory::open(path.parent().ok_or_else(invalid)?, true)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let _ownership = loop {
        match StateLock::acquire(path) {
            Ok(lock) => break lock,
            Err(error)
                if error.code == ErrorCode::Conflict && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            Err(error) => return Err(error),
        }
    };
    if let Some(key) = settings(path)? {
        return Ok(key);
    }
    let key = format!("{:x}", Sha256::digest(identity::random_bytes::<32>()?));
    let bytes = serde_json::to_vec_pretty(&json!({"schemaVersion":1,"authenticationKey":key}))
        .map_err(|_| invalid())?;
    parent.write_atomic(
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(invalid)?,
        &bytes,
    )?;
    read(path)
}

pub fn matches(header: Option<&str>, key: &Secret) -> bool {
    Secret::new(header.unwrap_or_default().to_owned())
        == Secret::new(format!("Bearer {}", key.expose()))
}
