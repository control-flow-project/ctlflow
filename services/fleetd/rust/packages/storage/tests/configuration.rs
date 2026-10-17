use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_domain::{
    identity::WakeMode,
    runtime::values::{HistoryMode, Runtime},
};
use fleetd_contracts::configuration as check;
use fleetd_storage::configuration;
use serde_json::json;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};

const ROSTER: &str = "fleet='agreements'\n[coordination]\nadapter='crossfire'\nserver='https://example.test'\nowner='@owner:example.test'\n[[instances]]\nkey='analyst'\nname='analyst-max'\ndefinition='analyst'\nworkarea='agents/analyst/workarea/analyst'\n[instances.listener_options]\nhistory_mode='per-room'\n[instances.runtime_options]\nmodel_reasoning_effort='max'\n";
const ROLE: &str = "name='Credit analyst'\nruntime='codex'\n[runtime_options]\nmodel='sol'\nmodel_reasoning_effort='high'\n";
fn fixture() -> Result<tempfile::TempDir, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    fs::create_dir_all(directory.path().join("agents/analyst"))?;
    fs::write(directory.path().join("runtime.toml"), ROSTER)?;
    fs::write(directory.path().join("agents/analyst/agent.toml"), ROLE)?;
    fs::write(
        directory.path().join("agents/analyst/AGENTS.md"),
        "Analyze, verify and consult specialists.",
    )?;
    for relative in [
        "runtime.toml",
        "agents/analyst/agent.toml",
        "agents/analyst/AGENTS.md",
    ] {
        fs::set_permissions(
            directory.path().join(relative),
            fs::Permissions::from_mode(0o600),
        )?;
    }
    for relative in ["agents", "agents/analyst"] {
        fs::set_permissions(
            directory.path().join(relative),
            fs::Permissions::from_mode(0o755),
        )?;
    }
    Ok(directory)
}
#[test]
fn exact_per_instance_options_replace_role_defaults_for_all_native_admission_consumers()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = fixture()?;
    let state = PrivateDirectory::open(&directory.path().join(".fleet"), true)?;
    state.write_atomic(
        "setup-instructions.json",
        b"{\"instructions\":\"Use tools for room replies.\"}",
    )?;
    let configuration = configuration::load(directory.path(), None)?;
    let instance = &configuration.roster.instances[0];
    assert_eq!(instance.history_mode, Some(HistoryMode::PerRoom));
    let role = configuration.definitions.get("analyst").ok_or("Role")?;
    assert_eq!(role.runtime, Runtime::Codex);
    assert_eq!(role.coordination_policy.mode, WakeMode::Selected);
    assert!(!role.coordination_policy.senders[0].include_agents);
    assert!(
        role.instructions
            .ends_with("\n\nUse tools for room replies.")
    );
    assert_eq!(role.options["model_reasoning_effort"], "high");
    for effort in ["low", "medium", "high", "xhigh", "max"] {
        let mut instance = instance.clone();
        instance.runtime_options = Some(
            json!({"model_reasoning_effort":effort})
                .as_object()
                .ok_or("Overrides")?
                .clone(),
        );
        let options = configuration.native_options(&instance)?;
        assert_eq!(options["model"], "sol");
        assert_eq!(
            crossfire_adapter_codex::options::parse(&json!(options))?
                .effort
                .as_deref(),
            Some(effort)
        );
    }
    let mut bad = instance.clone();
    bad.runtime_options = Some(
        json!({"model_reasoning_effort":"not-supported"})
            .as_object()
            .ok_or("Overrides")?
            .clone(),
    );
    assert!(
        crossfire_adapter_codex::options::parse(&json!(configuration.native_options(&bad)?))
            .is_err(),
        "No effort substitution"
    );
    let round_trip = check::roster(&configuration::roster_wire(&configuration.roster))?;
    assert_eq!(round_trip, configuration.roster);
    fs::write(
        directory.path().join("agents/analyst/AGENTS.md"),
        "Revised instructions.",
    )?;
    assert_ne!(
        configuration::load(directory.path(), None)?.digest,
        configuration.digest
    );
    Ok(())
}
#[test]
fn duplicate_names_workarea_overlap_unknown_runtime_and_noncanonical_options_are_rejected()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = fixture()?;
    let configuration = configuration::load(directory.path(), None)?;
    let value = configuration::roster_wire(&configuration.roster);
    let mut bad = value.clone();
    let mut duplicate = bad["instances"][0].clone();
    duplicate["key"] = json!("other");
    duplicate["workarea"] = json!("agents/analyst/workarea/other");
    bad["instances"]
        .as_array_mut()
        .ok_or("Roster")?
        .push(duplicate);
    assert!(
        check::roster(&bad).is_err(),
        "Duplicate deployed names fail before any native operation"
    );
    bad["instances"][1]["name"] = json!("other-high");
    bad["instances"][1]["workarea"] = json!("agents/analyst/workarea/analyst/nested");
    assert!(check::roster(&bad).is_err());
    for server in [
        "https://user:pass@example.test",
        "https://example.test/path",
        "http://example.test",
        "https://example.test/?secret=1",
    ] {
        let mut bad = value.clone();
        bad["coordination"]["server"] = json!(server);
        assert!(check::roster(&bad).is_err());
    }
    for server in [
        "http://127.0.0.1:1234",
        "http://[::1]:1234",
        "http://localhost:1234",
    ] {
        let mut accepted = value.clone();
        accepted["coordination"]["server"] = json!(server);
        check::roster(&accepted)?;
    }
    fs::write(
        directory.path().join("agents/analyst/agent.toml"),
        ROLE.replace("'codex'", "'claude'"),
    )?;
    assert!(configuration::load(directory.path(), None).is_err());
    let mut bad = value;
    bad["instances"][0]["runtime_options"] = json!([]);
    assert!(check::roster(&bad).is_err());
    Ok(())
}
#[test]
fn config_inputs_refuse_symlinks_shared_write_permissions_and_excessive_bytes_without_touching_external_files()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = fixture()?;
    let role = directory.path().join("agents/analyst/agent.toml");
    fs::set_permissions(&role, fs::Permissions::from_mode(0o666))?;
    assert!(configuration::load(directory.path(), None).is_err());
    fs::remove_file(&role)?;
    let external = directory.path().join("external");
    fs::write(&external, ROLE)?;
    symlink(&external, &role)?;
    assert!(configuration::load(directory.path(), None).is_err());
    assert_eq!(fs::read_to_string(&external)?, ROLE);
    fs::remove_file(&role)?;
    fs::write(&role, ROLE)?;
    let root_alias = directory.path().with_extension("alias");
    symlink(directory.path(), &root_alias)?;
    assert!(configuration::load(&root_alias, None).is_err());
    fs::remove_file(root_alias)?;
    fs::write(
        directory.path().join("agents/analyst/AGENTS.md"),
        vec![b'a'; 128 * 1024 + 1],
    )?;
    assert!(configuration::load(directory.path(), None).is_err());
    Ok(())
}
