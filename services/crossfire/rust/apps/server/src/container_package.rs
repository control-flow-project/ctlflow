use crate::container_commands as docker;
use crossfire_adapter_filesystem::assets::Directory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, os::unix::fs::MetadataExt, path::Path};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageImage {
    pub reference: String,
    pub config_digest: String,
    pub descriptor_digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContainerPackage {
    pub schema_version: u8,
    pub version: String,
    pub source_digest: String,
    pub backend: String,
    pub platform: String,
    pub archive_sha256: String,
    pub runtime: PackageImage,
    pub migration: PackageImage,
}
pub struct PreparedContainerPackage {
    pub package: ContainerPackage,
    pub runtime_image: String,
    pub migration_image: String,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn image(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(digest)
}
fn package_image(value: &PackageImage) -> bool {
    value
        .reference
        .strip_prefix("crossfire-package:")
        .is_some_and(digest)
        && image(&value.config_digest)
        && image(&value.descriptor_digest)
}
fn version(value: &str) -> bool {
    let (base, suffix) = value
        .split_once('-')
        .map_or((value, None), |(base, suffix)| (base, Some(suffix)));
    let components: Vec<_> = base.split('.').collect();
    components.len() == 3
        && components
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && suffix.is_none_or(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".-".contains(&byte))
        })
}
pub fn parse(input: &Value) -> Result<ContainerPackage> {
    let mut normalized = input.clone();
    if normalized.get("schemaVersion").and_then(Value::as_f64) == Some(2.0) {
        normalized["schemaVersion"] = 2.into();
    }
    let value: ContainerPackage = serde_json::from_value(normalized)
        .map_err(|_| invalid("Invalid container package manifest"))?;
    if value.schema_version != 2
        || value.platform != "linux/amd64"
        || !version(&value.version)
        || value.backend == "migrations"
        || value.backend.len() > 64
        || !value
            .backend
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_lowercase)
        || !value
            .backend
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || !digest(&value.source_digest)
        || !digest(&value.archive_sha256)
        || !package_image(&value.runtime)
        || !package_image(&value.migration)
        || value.runtime.reference == value.migration.reference
        || value.runtime.config_digest == value.migration.config_digest
        || value.runtime.descriptor_digest == value.migration.descriptor_digest
    {
        return Err(invalid("Invalid container package manifest"));
    }
    Ok(value)
}
pub fn native_image_identity(expected: &PackageImage, input: &Value) -> Result<String> {
    let mut identity = &expected.config_digest;
    if let Some(descriptor) = input.get("Descriptor").filter(|value| !value.is_null()) {
        let valid_media = descriptor
            .get("mediaType")
            .and_then(Value::as_str)
            .is_some_and(|media| {
                matches!(
                    media,
                    "application/vnd.oci.image.manifest.v1+json"
                        | "application/vnd.oci.image.index.v1+json"
                        | "application/vnd.docker.distribution.manifest.v2+json"
                        | "application/vnd.docker.distribution.manifest.list.v2+json"
                )
            });
        if !valid_media
            || descriptor.get("digest").and_then(Value::as_str)
                != Some(expected.descriptor_digest.as_str())
        {
            return Err(invalid("Container image descriptor does not match"));
        }
        identity = &expected.descriptor_digest;
    }
    if input.get("Id").and_then(Value::as_str) != Some(identity.as_str()) {
        return Err(invalid("Container image identity does not match"));
    }
    Ok(identity.clone())
}
pub fn labels(value: &ContainerPackage, backend: &str) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("org.crossfire.package".into(), "1".into()),
        (
            "org.opencontainers.image.version".into(),
            value.version.clone(),
        ),
        ("org.crossfire.source".into(), value.source_digest.clone()),
        ("org.crossfire.backend".into(), backend.into()),
    ])
}
pub async fn prepare(
    directory: &Path,
    workspace: &Path,
    stop: CancellationToken,
) -> Result<PreparedContainerPackage> {
    let files = Directory::open(directory)?;
    let manifest = files
        .file("release.json", 8192)?
        .ok_or_else(|| invalid("Container package manifest is missing"))?;
    let value = parse(
        &serde_json::from_slice::<Value>(&manifest.read(8192)?)
            .map_err(|_| invalid("Invalid container package manifest"))?,
    )?;
    let archive = files
        .file("images.tar", 17_179_869_184)?
        .ok_or_else(|| invalid("Container package archive is missing"))?;
    let before = archive.metadata()?;
    if before.len() == 0 {
        return Err(invalid(
            "Container package files must be bounded regular files",
        ));
    }
    let mut file = tokio::fs::File::from_std(archive.into_file());
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 65536];
    let mut size = 0u64;
    loop {
        let count = tokio::select! { biased;
            _ = stop.cancelled() => return Err(invalid("Container package verification cancelled")),
            count = file.read(&mut buffer) => count.map_err(|_| invalid("Cannot read container package archive"))?,
        };
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > before.len() {
            return Err(invalid(
                "Container package archive changed during verification",
            ));
        }
        hash.update(&buffer[..count]);
    }
    let after = file
        .metadata()
        .await
        .map_err(|_| invalid("Cannot inspect container package archive"))?;
    if size != before.len()
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(invalid(
            "Container package archive changed during verification",
        ));
    }
    if format!("{:x}", hash.finalize()) != value.archive_sha256 {
        return Err(invalid("Container package archive SHA-256 does not match"));
    }
    let selections = [
        (&value.runtime, value.backend.as_str()),
        (&value.migration, "migrations"),
    ];
    let mut present = true;
    for (selected, _) in selections {
        if !docker::image(&selected.reference, workspace, stop.clone()).await? {
            present = false;
        }
    }
    if !present {
        let path = directory.join("images.tar");
        let path = path
            .to_str()
            .ok_or_else(|| invalid("Package paths must be valid Unicode"))?;
        docker::run(
            &["load".into(), "--input".into(), path.into()],
            workspace,
            stop.clone(),
        )
        .await?;
    }
    let mut identities = Vec::new();
    for (selected, backend) in selections {
        let inspected = docker::captured(
            &["image".into(), "inspect".into(), selected.reference.clone()],
            workspace,
            stop.clone(),
        )
        .await?;
        if !inspected.status.success() {
            return Err(invalid("Container package is missing its exact image"));
        }
        let entries: Value = serde_json::from_str(&inspected.output)
            .map_err(|_| invalid("Invalid container image inspection"))?;
        let entries = entries
            .as_array()
            .filter(|entries| entries.len() == 1)
            .ok_or_else(|| invalid("Container package image inspection is ambiguous"))?;
        let found = &entries[0];
        identities.push(native_image_identity(selected, found)?);
        if found.get("Os").and_then(Value::as_str) != Some("linux")
            || found.get("Architecture").and_then(Value::as_str) != Some("amd64")
            || labels(&value, backend).iter().any(|(key, expected)| {
                found
                    .pointer("/Config/Labels")
                    .and_then(|labels| labels.get(key))
                    .and_then(Value::as_str)
                    != Some(expected)
            })
        {
            return Err(invalid(
                "Container package image identity, platform or release labels do not match",
            ));
        }
    }
    Ok(PreparedContainerPackage {
        package: value,
        runtime_image: identities[0].clone(),
        migration_image: identities[1].clone(),
    })
}
