use crossfire_adapter_crossfire::agent_software;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_contracts::release::{ARTIFACTS, Artifact, Manifest};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, os::unix::fs::PermissionsExt};

#[test]
fn verified_software_installs_atomically_and_never_replaces_an_unmanaged_entry_or_mutated_release()
-> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o700))?;
    let release_directory = temporary.path().join("release");
    let private = PrivateDirectory::open(&release_directory, true)?;
    let mut identity = Sha256::new();
    let mut artifacts = BTreeMap::new();
    for name in ARTIFACTS {
        let bytes = format!("Reviewed {name}\n");
        let digest = format!("{:x}", Sha256::digest(bytes.as_bytes()));
        identity.update(name.as_bytes());
        identity.update([0]);
        identity.update(digest.as_bytes());
        identity.update([0]);
        artifacts.insert(
            name.to_owned(),
            Artifact {
                bytes: bytes.len(),
                sha256: digest,
            },
        );
        private.write_new(name, bytes.as_bytes())?;
    }
    let identity = format!("0.1.20-{}", &format!("{:x}", identity.finalize())[..24]);
    private.write_new(
        "manifest.json",
        &serde_json::to_vec(&Manifest {
            release: identity.clone(),
            version: "0.1.20".to_owned(),
            artifacts,
        })?,
    )?;
    let root = temporary.path().join("project");
    let installed = agent_software::install(&root, &release_directory)?;
    assert!(
        agent_software::installed(&root).is_err(),
        "An installation is not implicitly activated"
    );
    installed.activate(&root)?;
    assert_eq!(
        agent_software::installed(&root)?.release.manifest.release,
        identity
    );
    let again = agent_software::install(&root, &release_directory)?;
    again.activate(&root)?;
    assert_eq!(
        fs::read_link(root.join("client.mjs"))?,
        std::path::PathBuf::from(format!("software/{identity}/crossfire-client.mjs"))
    );
    assert_eq!(
        fs::metadata(again.directory.join("SKILL.md"))?
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let contents = fs::read(root.join("client.mjs"))?;
    private.write_atomic("crossfire-client.mjs", b"mutated")?;
    assert!(agent_software::install(&root, &release_directory).is_err());
    assert_eq!(fs::read(root.join("client.mjs"))?, contents);
    let foreign = temporary.path().join("unmanaged");
    PrivateDirectory::open(&foreign, true)?.write_new("client.mjs", b"authored")?;
    assert!(agent_software::install(&foreign, &again.directory).is_err());
    assert_eq!(fs::read(foreign.join("client.mjs"))?, b"authored");
    Ok(())
}
