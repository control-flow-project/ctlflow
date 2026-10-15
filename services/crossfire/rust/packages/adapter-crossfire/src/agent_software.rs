use crossfire_adapter_filesystem::{
    PrivateDirectory,
    lock::StateLock,
    release::{self, Release},
};
use crossfire_contracts::release as contract;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use std::path::{Path, PathBuf};

pub struct Installed {
    pub release: Release,
    pub directory: PathBuf,
    pub skill: String,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn installed(root: &Path) -> Result<Installed> {
    let private = PrivateDirectory::open(root, false)?;
    let link = private.managed_link("client.mjs")?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Missing,
            "Automatic recovery requires the previously approved controller-installed software",
        )
    })?;
    let parts = link.split('/').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != "software" || parts[2] != "crossfire-client.mjs" {
        return Err(invalid(
            "The project client entry is not a managed Crossfire installation",
        ));
    }
    contract::identity(parts[1])?;
    private.child("software", false)?.child(parts[1], false)?;
    let directory = root.join("software").join(parts[1]);
    let release = release::load(&directory)?;
    if release.manifest.release != parts[1] {
        return Err(invalid(
            "Installed release identity differs from its directory",
        ));
    }
    let skill = std::str::from_utf8(
        release
            .files
            .get("SKILL.md")
            .ok_or_else(|| invalid("Installed skill is missing"))?,
    )
    .map_err(|_| invalid("Installed skill is not UTF-8"))?
    .to_owned();
    Ok(Installed {
        release,
        directory,
        skill,
    })
}
pub fn install(root: &Path, source: &Path) -> Result<Installed> {
    let private = PrivateDirectory::open(root, true)?;
    let _lock = StateLock::acquire(&root.join("software-install"))?;
    let approved = release::load(source)?;
    if private.managed_link("client.mjs")?.is_some() {
        installed(root)?;
    }
    let software = private.child("software", true)?;
    let directory = root.join("software").join(&approved.manifest.release);
    if software
        .child_optional(&approved.manifest.release, false)?
        .is_none()
    {
        let name = format!(".install-{}", identity::id());
        let staging = software.child(&name, true)?;
        let result = (|| {
            for (name, bytes) in &approved.files {
                staging.write_new(name, bytes)?;
            }
            let manifest = serde_json::to_vec(&approved.manifest)
                .map_err(|_| invalid("Release manifest encoding failed"))?;
            staging.write_new("manifest.json", &manifest)?;
            release::load(&root.join("software").join(&name))?;
            software.publish_directory(&name, &approved.manifest.release)
        })();
        if result.is_err() {
            for name in contract::ARTIFACTS.into_iter().chain(["manifest.json"]) {
                staging.remove_optional(name)?;
            }
            software.remove_empty_directory(&name)?;
        }
        result?;
    }
    software.child(&approved.manifest.release, false)?;
    let release = release::load(&directory)?;
    if release.manifest.release != approved.manifest.release {
        return Err(invalid(
            "Installed release differs from the approved manifest",
        ));
    }
    let skill = std::str::from_utf8(
        release
            .files
            .get("SKILL.md")
            .ok_or_else(|| invalid("Installed skill is missing"))?,
    )
    .map_err(|_| invalid("Installed skill is not UTF-8"))?
    .to_owned();
    Ok(Installed {
        release,
        directory,
        skill,
    })
}
impl Installed {
    pub fn activate(&self, root: &Path) -> Result<()> {
        PrivateDirectory::open(root, false)?.replace_managed_link(
            "client.mjs",
            &format!(
                "software/{}/crossfire-client.mjs",
                self.release.manifest.release
            ),
        )
    }
}
