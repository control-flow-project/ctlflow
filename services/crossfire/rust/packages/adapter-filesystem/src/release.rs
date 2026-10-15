use crate::assets::Directory;
use crossfire_contracts::release::{ARTIFACTS, MAX_ARTIFACT_BYTES, Manifest};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, sync::Arc};
pub struct Release {
    pub manifest: Manifest,
    pub files: BTreeMap<String, Arc<[u8]>>,
}
pub fn load(directory: &Path) -> Result<Release> {
    let directory = Directory::open(directory)?;
    let read = |name: &str, maximum: usize| {
        let file = directory.file(name, maximum as u64)?.ok_or_else(invalid)?;
        let bytes = file.read(maximum)?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        Ok(bytes)
    };
    let bytes = read("manifest.json", 16384)?;
    let value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let manifest = crossfire_contracts::release::parse(&value)?;
    let mut files = BTreeMap::new();
    let mut identity = Sha256::new();
    for name in ARTIFACTS {
        let bytes = read(name, MAX_ARTIFACT_BYTES)?;
        let expected = manifest.artifacts.get(name).ok_or_else(invalid)?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if bytes.len() != expected.bytes || digest != expected.sha256 {
            return Err(invalid());
        }
        identity.update(name.as_bytes());
        identity.update([0]);
        identity.update(digest.as_bytes());
        identity.update([0]);
        files.insert(name.to_owned(), Arc::from(bytes));
    }
    if manifest.release
        != format!(
            "{}-{}",
            manifest.version,
            &format!("{:x}", identity.finalize())[..24]
        )
    {
        return Err(invalid());
    }
    Ok(Release { manifest, files })
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Published release content does not match its verified manifest",
    )
}
