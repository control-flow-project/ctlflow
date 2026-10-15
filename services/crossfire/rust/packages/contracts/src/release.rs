use crate::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const ARTIFACTS: [&str; 4] = [
    "README.md",
    "SKILL.md",
    "crossfire-client.mjs",
    "matrix-spec-LICENSE.txt",
];
pub const MAX_ARTIFACT_BYTES: usize = 8 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub bytes: usize,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub release: String,
    pub version: String,
    pub artifacts: BTreeMap<String, Artifact>,
}
pub fn parse(value: &Value) -> Result<Manifest> {
    let value = check::object(value, &["release", "version", "artifacts"], &[])?;
    let version = check::text(&value["version"], 1, 40)?;
    let release = check::text(&value["release"], 1, 200)?;
    identity(release)?;
    if !release.starts_with(&format!("{version}-")) {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid release identity"));
    }
    let files = check::object(&value["artifacts"], &ARTIFACTS, &[])?;
    let artifacts = ARTIFACTS
        .into_iter()
        .map(|name| {
            let file = check::object(&files[name], &["bytes", "sha256"], &[])?;
            let sha256 = check::text(&file["sha256"], 64, 64)?;
            if !hex(sha256, 64) {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Invalid bounded artifact metadata",
                ));
            }
            Ok((
                name.to_owned(),
                Artifact {
                    bytes: check::integer(&file["bytes"], 1, MAX_ARTIFACT_BYTES as i64)? as usize,
                    sha256: sha256.to_owned(),
                },
            ))
        })
        .collect::<Result<_>>()?;
    Ok(Manifest {
        release: release.to_owned(),
        version: version.to_owned(),
        artifacts,
    })
}
pub fn identity(release: &str) -> Result<()> {
    let (version, digest) = release
        .rsplit_once('-')
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Invalid release identity"))?;
    let mut parts = version.split('.');
    if release.len() > 200
        || !hex(digest, 24)
        || parts.clone().count() != 3
        || parts.any(|part| part.is_empty() || !part.bytes().all(|value| value.is_ascii_digit()))
    {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid release identity"));
    }
    Ok(())
}
fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
}
