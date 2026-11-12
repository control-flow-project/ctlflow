use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_process::{NativeCommand, capture};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::execution::Image;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, time::Duration};
use tokio_util::sync::CancellationToken;

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn self_contained(image: &Value, path: &str) -> bool {
    if !image.is_object()
        || image["format"].as_str() != Some("qcow2")
        || image["filename"].as_str() != Some(path)
        || !image["virtual-size"]
            .as_i64()
            .is_some_and(|value| value > 0)
        || [
            "backing-filename",
            "full-backing-filename",
            "backing-filename-format",
        ]
        .iter()
        .any(|key| image.get(key).is_some())
        || image
            .get("encrypted")
            .is_some_and(|value| value.as_bool() != Some(false))
        || image["dirty-flag"].as_bool() != Some(false)
        || image["format-specific"]["type"].as_str() != Some("qcow2")
    {
        return false;
    }
    let data = &image["format-specific"]["data"];
    if !data.is_object()
        || data.get("data-file").is_some()
        || data.get("encrypt").is_some()
        || data["corrupt"].as_bool() != Some(false)
    {
        return false;
    }
    let Some(children) = image["children"]
        .as_array()
        .filter(|values| values.len() == 1)
    else {
        return false;
    };
    let child = &children[0];
    let file = &child["info"];
    child["name"].as_str() == Some("file")
        && file["format"].as_str() == Some("file")
        && file["filename"].as_str() == Some(path)
        && file["children"].as_array().is_some_and(Vec::is_empty)
}

pub async fn verify(image: &Image, cancellation: CancellationToken) -> Result<()> {
    let path = image
        .path
        .to_str()
        .filter(|path| {
            fleetd_contracts::configuration::absolute_path(path)
                && !path.chars().any(char::is_control)
        })
        .ok_or_else(|| {
            invalid("VM image requires an exact private path and lowercase SHA256 digest")
        })?;
    if image.sha256.len() != 64
        || !image
            .sha256
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err(invalid(
            "VM image requires an exact private path and lowercase SHA256 digest",
        ));
    }
    let hash_image = image.clone();
    let stop = cancellation.clone();
    let digest = tokio::task::spawn_blocking(move || -> Result<String> {
        let parent = hash_image
            .path
            .parent()
            .ok_or_else(|| invalid("VM image has no private parent"))?;
        PrivateDirectory::open(parent, false)?;
        let file = OwnedFile::open(&hash_image.path, u64::MAX)?
            .ok_or_else(|| invalid("VM image does not exist"))?;
        file.private_permissions()?;
        let mut file = file.into_file();
        let mut hash = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            if stop.is_cancelled() {
                return Err(invalid("VM image verification cancelled"));
            }
            let count = file
                .read(&mut buffer)
                .map_err(|_| invalid("Cannot read private VM image"))?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        Ok(format!("{:x}", hash.finalize()))
    })
    .await
    .map_err(|_| invalid("VM image verification task failed"))??;
    if digest != image.sha256 {
        return Err(invalid(
            "VM image does not match its fleet-approved SHA256 digest",
        ));
    }
    let inspected = capture(
        &NativeCommand {
            binary: "/usr/bin/qemu-img".into(),
            arguments: vec![
                "info".into(),
                "--output=json".into(),
                "-f".into(),
                "qcow2".into(),
                image.path.clone().into_os_string(),
            ],
            workspace: image
                .path
                .parent()
                .ok_or_else(|| invalid("VM image has no parent"))?
                .to_owned(),
            environment: BTreeMap::new(),
            input: false,
        },
        65536,
        Duration::from_secs(30),
        cancellation,
    )
    .await?;
    let metadata: Value = serde_json::from_str(&inspected.output)
        .map_err(|_| invalid("Cannot inspect current qcow2 metadata"))?;
    if !inspected.status.success() || !self_contained(&metadata, path) {
        return Err(invalid(
            "VM image must be a clean self-contained qcow2 file without external backing, data or encryption",
        ));
    }
    Ok(())
}
