use crossfire_kernel::{failure::ErrorCode, identity};
use fleetd_domain::{controller_model::*, controller_ports::Registry as RegistryPort};
use fleetd_storage::{registry::Registry, setup::Setup};
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn generated_setup_is_private_repeatable_and_preserves_its_original_authority_and_instructions()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
    let workspace = root.path().join("Useful Project");
    fs::create_dir(&workspace)?;
    fs::set_permissions(&workspace, fs::Permissions::from_mode(0o755))?;
    let request = SetupRequest {
        descriptor: SetupDescriptor {
            server: "https://example.test".to_owned(),
            owner: "@owner:example.test".to_owned(),
            package_version: "0.1.20".to_owned(),
            instructions: "Original reviewed instructions".to_owned(),
        },
        workspace,
        configuration: None,
    };
    let registry = Registry::open(&root.path().join("controller"))?;
    let first = registry
        .setup(&request)
        .map_err(|error| error.field("initialSetup"))?;
    let second = registry
        .setup(&request)
        .map_err(|error| error.field("repeatSetup"))?;
    assert_eq!(first.operation_id, second.operation_id);
    assert_eq!(
        first.configuration.directory,
        second.configuration.directory
    );
    assert_eq!(first.configuration.digest, second.configuration.digest);
    assert!(
        first
            .configuration
            .roster
            .fleet
            .starts_with("useful-project-")
    );
    assert!(
        first.configuration.definitions["project"]
            .instructions
            .contains("Original reviewed instructions")
    );
    let metadata = fs::metadata(
        first
            .configuration
            .directory
            .join(".fleet/setup-instructions.json"),
    )?;
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    let mut changed = request.clone();
    changed.descriptor.instructions =
        "Later text must not silently change initial authority".to_owned();
    assert_eq!(
        registry.setup(&changed)?.configuration.digest,
        first.configuration.digest
    );
    registry.complete_setup(&first.operation_id)?;
    assert!(registry.setup(&request)?.completed);
    assert_eq!(
        registry
            .retry_setup(&first.operation_id, &identity::id())
            .err()
            .ok_or("Completed setup cannot retry")?
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(
        Setup::open(&root.path().join("controller"))?
            .prepare(&request)?
            .operation_id,
        first.operation_id
    );
    Ok(())
}
#[test]
fn operation_retention_keeps_pending_and_unacknowledged_outcomes_and_cleans_only_owned_staging()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
    let registry = Registry::open(root.path())?;
    let operation = Operation {
        request: OperationRequest {
            id: identity::id(),
            target: Target::Daemon,
            action: Action::Stop,
            expected_revision: 0,
            release_directory: None,
        },
        status: OperationStatus::Running,
        created_at: 1,
        completed_at: None,
        approval: None,
        errors: vec![],
        receipt_pending: false,
    };
    registry.save_operation(&operation)?;
    let staging = root
        .path()
        .join("operations")
        .join(format!(".pending-{}", identity::id()));
    fs::write(&staging, b"incomplete")?;
    fs::set_permissions(&staging, fs::Permissions::from_mode(0o600))?;
    assert_eq!(registry.pending_operations()?.len(), 1);
    assert!(!staging.exists());
    assert!(!registry.prune_operations(20, 500)?);
    let mut completed = operation.clone();
    completed.status = OperationStatus::Succeeded;
    completed.completed_at = Some(10);
    completed.receipt_pending = true;
    registry.save_operation(&completed)?;
    assert!(!registry.prune_operations(20, 500)?);
    completed.receipt_pending = false;
    registry.save_operation(&completed)?;
    registry.prune_operations(20, 500)?;
    assert!(registry.operation(&operation.request.id)?.is_none());
    let outside = root.path().join("outside");
    fs::write(&outside, b"authored")?;
    std::os::unix::fs::symlink(
        &outside,
        root.path()
            .join("operations")
            .join(format!(".pending-{}", identity::id())),
    )?;
    assert!(registry.pending_operations().is_err());
    assert_eq!(fs::read(&outside)?, b"authored");
    Ok(())
}
