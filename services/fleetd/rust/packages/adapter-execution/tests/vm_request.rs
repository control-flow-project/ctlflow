use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::placement::LeaseRequest;
use fleetd_adapter_execution::vm::{execution_files, placement, request::Request};
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn current_request_admits_only_its_exact_fleet_native_ownership()
-> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../tests/contracts/execution-selection-cases.json"
    ))?;
    let sample = cases
        .iter()
        .find(|value| value["name"] == "fleet-approved VM")
        .ok_or("Missing shared execution fixture")?;
    let root = tempfile::tempdir()?;
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
    let fleet = root.path().join("fleet");
    PrivateDirectory::open(&fleet, true)?;
    let role = fleet.join("agents/research");
    let private = PrivateDirectory::open(&role, true)?;
    private.write_atomic(
        "agent.toml",
        b"name=\"Research\"\nruntime=\"codex\"\n[runtime_options]\n",
    )?;
    private.write_atomic("AGENTS.md", b"Only the request test fixture.")?;
    let private = PrivateDirectory::open(&fleet, false)?;
    private.write_atomic(
        "runtime.toml",
        fleetd_storage::configuration::format(&sample["roster"])?.as_bytes(),
    )?;
    private.write_atomic(
        "execution.toml",
        fleetd_storage::configuration::format(&sample["catalog"])?.as_bytes(),
    )?;
    let configuration = fleetd_storage::configuration::load(&fleet, None)?;
    let instance = configuration.roster.instances[0].clone();
    let state = fleet.join(&instance.workarea);
    PrivateDirectory::open(&state, true)?;
    let id = crossfire_kernel::identity::id();
    execution_files::create(&id)?;
    let control = execution_files::runtime(&id)?;
    let request = Request {
        id: id.clone(),
        directory: control.clone(),
        fleet,
        instance: instance.key.clone(),
        digest: configuration.digest.clone(),
        native: LeaseRequest {
            directory: fleetd_storage::ownership::directory(&state)?,
            workspace: state.clone(),
            state_directory: state.clone(),
            home: state.join(".codex"),
        },
        listener_port: None,
    };
    request.write()?;
    let loaded = Request::read(&request.file()?)?;
    let selection = loaded.select()?;
    assert_eq!(selection.mounts.len(), 1);
    assert_eq!(selection.mounts[0].path, state);
    assert!(!selection.mounts[0].read_only);
    let mut invalid = request.clone();
    invalid.directory = root.path().to_owned();
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.digest = "changed".to_owned();
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.instance = "missing".to_owned();
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.listener_port = Some(0);
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.native.directory = state.clone();
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.native.workspace = root.path().to_owned();
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.native.state_directory = root.path().to_owned();
    invalid.native.home = root.path().join(".codex");
    assert!(invalid.select().is_err());
    let mut invalid = request.clone();
    invalid.native.home = state.join(".other");
    assert!(invalid.select().is_err());
    let before = fs::read_dir(&control)?.count();
    let _factory = placement::create(configuration, instance, None);
    assert_eq!(fs::read_dir(&control)?.count(), before);
    assert!(!request.ready().exists());
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(request.file()?)?)?;
    value["extra"] = serde_json::json!(true);
    PrivateDirectory::open(&request.scratch()?, false)?
        .write_atomic("request.json", &serde_json::to_vec(&value)?)?;
    assert!(Request::read(&request.file()?).is_err());
    PrivateDirectory::open(&role, false)?.write_atomic(
        "agent.toml",
        b"name=\"Research\"\nruntime=\"pi\"\n[runtime_options]\n",
    )?;
    let pi = fleetd_storage::configuration::load(&request.fleet, None)?;
    let mut pi_request = request.clone();
    pi_request.digest = pi.digest;
    pi_request.native.home = state.join(".pi");
    assert_eq!(pi_request.select()?.mounts[0].path, state);
    pi_request.native.home = state.join(".codex");
    assert!(pi_request.select().is_err());
    execution_files::remove(&id)?;
    Ok(())
}
