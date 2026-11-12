use fleetd_domain::execution::Placement;
use fleetd_storage::configuration::{format, load, write_roster};
use serde_json::Value;
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn execution_catalog_is_validated_hashed_and_retained_by_roster_edits()
-> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/execution-selection-cases.json"
    ))?;
    let sample = cases
        .iter()
        .find(|sample| sample["name"] == "fleet-approved VM")
        .ok_or("Missing sample")?;
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let role = directory.path().join("agents/research");
    fs::create_dir_all(&role)?;
    fs::write(
        role.join("agent.toml"),
        "name=\"Research\"\nruntime=\"codex\"\n[runtime_options]\n",
    )?;
    fs::write(role.join("AGENTS.md"), "Fixture instructions.")?;
    fs::write(
        directory.path().join("runtime.toml"),
        format(&sample["roster"])?,
    )?;
    for file in [
        "runtime.toml",
        "agents/research/agent.toml",
        "agents/research/AGENTS.md",
    ] {
        fs::set_permissions(
            directory.path().join(file),
            fs::Permissions::from_mode(0o600),
        )?;
    }
    for path in ["agents", "agents/research"] {
        fs::set_permissions(
            directory.path().join(path),
            fs::Permissions::from_mode(0o755),
        )?;
    }
    assert!(
        load(directory.path(), None).is_err(),
        "VM without a catalog cannot become host execution"
    );
    let catalog = format(&sample["catalog"])?;
    fs::write(directory.path().join("execution.toml"), &catalog)?;
    fs::set_permissions(
        directory.path().join("execution.toml"),
        fs::Permissions::from_mode(0o600),
    )?;
    let first = load(directory.path(), None)?;
    assert_eq!(
        first.roster.instances[0].execution,
        Placement::Vm {
            image: "python".to_owned(),
            profile: "research".to_owned()
        }
    );
    assert_eq!(
        first.execution.as_ref().ok_or("Missing catalog")?.profiles["research"].memory_mib,
        512
    );
    let rewritten = write_roster(&first, &first.roster)?;
    assert_eq!(
        rewritten.roster.instances[0].execution,
        first.roster.instances[0].execution
    );
    fs::write(
        directory.path().join("execution.toml"),
        catalog.replace("1024", "1536"),
    )?;
    let changed = load(directory.path(), None)?;
    assert_ne!(
        changed.digest, rewritten.digest,
        "Catalog edits invalidate the previous fleet revision"
    );
    assert!(
        write_roster(&rewritten, &rewritten.roster).is_err(),
        "Stale roster cannot overwrite a catalog edit"
    );
    Ok(())
}
