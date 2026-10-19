#[path = "support/controller.rs"]
mod fixture;
use crossfire_kernel::{Result, failure::ErrorCode, identity, time::Clock};
use fixture::{Calls, Host};
use fleetd_domain::{
    controller::Controller, controller_model::*, controller_ports::Registry as RegistryPort,
    model::DesiredIntent,
};
use fleetd_storage::registry::Registry;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

#[derive(Clone)]
struct Time;
impl Clock for Time {
    fn now(&self) -> Result<i64> {
        Ok(1792000000000)
    }
}
type ControllerUnderTest = Controller<Registry, Host, Time>;
#[tokio::test(start_paused = true)]
async fn transient_initial_start_failure_recovers_the_requested_identity_without_another_request()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, directory) = setup()?;
    let current = controller(registry, host.clone())?;
    current.ready().await?;
    let fleet = current.add(&directory)?.registration.fleet_id;
    host.0.start_fails_once.store(true, Ordering::SeqCst);
    let result = operate(
        &current,
        Target::Agent {
            fleet: fleet.clone(),
            instance: "alpha".to_owned(),
        },
        Action::Start,
    )
    .await?;
    assert_eq!(
        result.status,
        OperationStatus::Failed,
        "The original failed operation is never falsely reported successful"
    );
    for _ in 0..256 {
        tokio::time::advance(Duration::from_millis(100)).await;
        if current.view(&fleet)?.instances.iter().any(|instance| {
            instance.instance.key == "alpha" && instance.phase == InstancePhase::Running
        }) {
            break;
        }
        tokio::task::yield_now().await;
    }
    let view = current.view(&fleet)?;
    let alpha = view
        .instances
        .iter()
        .find(|instance| instance.instance.key == "alpha")
        .ok_or("Requested identity")?;
    assert_eq!(alpha.phase, InstancePhase::Running);
    assert_eq!(alpha.session_id.as_deref(), Some("saved-alpha"));
    assert!(alpha.desired_active);
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 2);
    current.close().await?;
    Ok(())
}
#[tokio::test]
async fn failed_controller_shutdown_keeps_cleanup_retryable_without_starting_replacements()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, directory) = setup()?;
    let current = controller(registry, host.clone())?;
    current.ready().await?;
    let fleet = current.add(&directory)?.registration.fleet_id;
    assert_eq!(
        operate(
            &current,
            Target::Agent {
                fleet,
                instance: "alpha".to_owned()
            },
            Action::Start
        )
        .await?
        .status,
        OperationStatus::Succeeded
    );
    host.0.close_fails.store(true, Ordering::SeqCst);
    assert!(current.close().await.is_err());
    host.0.close_fails.store(false, Ordering::SeqCst);
    current.close().await?;
    current.close().await?;
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 1);
    assert_eq!(host.0.closes.load(Ordering::SeqCst), 1);
    Ok(())
}
type Fixture = (
    tempfile::TempDir,
    Arc<Registry>,
    Arc<Host>,
    std::path::PathBuf,
);

#[tokio::test]
async fn diagnostics_preserve_registry_and_activation_without_starting_native_work()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, directory) = setup()?;
    let current = controller(registry.clone(), host.clone())?;
    current.ready().await?;
    let fleet = current.add(&directory)?.registration.fleet_id;
    let before = registry.desired()?;
    let scope = fleetd_domain::diagnostics::Scope {
        fleet_id: Some(fleet.clone()),
        instance_key: None,
    };
    let report = current
        .diagnostics(
            scope,
            crossfire_agent_core::synchronization::CancellationToken::new(),
        )
        .await?;
    assert_eq!(
        report
            .checks
            .iter()
            .filter(|check| check.id == "agent.native")
            .count(),
        2
    );
    assert!(
        report
            .checks
            .iter()
            .filter(|check| check.id == "agent.native")
            .all(|check| check.message == "Native state: stopped")
    );
    assert!(
        report
            .checks
            .iter()
            .filter(|check| check.id == "agent.provider")
            .all(|check| check.status == "not-applicable")
    );
    assert_eq!(registry.desired()?, before);
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 0);
    operate(
        &current,
        Target::Agent {
            fleet: fleet.clone(),
            instance: "alpha".to_owned(),
        },
        Action::Start,
    )
    .await?;
    let before = registry.desired()?;
    let report = current
        .diagnostics(
            fleetd_domain::diagnostics::Scope {
                fleet_id: Some(fleet),
                instance_key: Some("alpha".to_owned()),
            },
            crossfire_agent_core::synchronization::CancellationToken::new(),
        )
        .await?;
    assert_eq!(
        report
            .checks
            .iter()
            .find(|check| check.id == "agent.native")
            .map(|check| check.message.as_str()),
        Some("Native state: idle")
    );
    assert_eq!(registry.desired()?, before);
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 1);
    assert_eq!(host.0.closes.load(Ordering::SeqCst), 0);
    current.close().await?;
    Ok(())
}
fn setup() -> std::result::Result<Fixture, Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700))?;
    let fleet = root.path().join("fleet");
    let role = fleet.join("agents/role");
    fs::create_dir_all(&role)?;
    fs::write(
        role.join("agent.toml"),
        "name = \"Analyst\"\nruntime = \"codex\"\n[runtime_options]\nsandbox_mode = \"read-only\"\napproval_policy = \"never\"\n",
    )?;
    fs::write(role.join("AGENTS.md"), "Current instructions\n")?;
    fs::write(
        fleet.join("runtime.toml"),
        "fleet = \"research\"\n[coordination]\nadapter = \"crossfire\"\nserver = \"https://example.test\"\nowner = \"@owner:example.test\"\n[[instances]]\nkey = \"alpha\"\nname = \"alpha\"\ndefinition = \"role\"\nworkarea = \"agents/role/workarea/alpha\"\n[[instances]]\nkey = \"beta\"\nname = \"beta\"\ndefinition = \"role\"\nworkarea = \"agents/role/workarea/beta\"\n",
    )?;
    for path in [&fleet, &fleet.join("agents"), &role] {
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    for path in [
        role.join("agent.toml"),
        role.join("AGENTS.md"),
        fleet.join("runtime.toml"),
    ] {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok((
        root,
        Arc::new(Registry::open(
            &fleet.parent().ok_or("Parent")?.join("controller"),
        )?),
        Arc::new(Host(Arc::new(Calls::default()))),
        fleet,
    ))
}
fn controller(registry: Arc<Registry>, host: Arc<Host>) -> Result<Arc<ControllerUnderTest>> {
    Controller::open(
        registry,
        host,
        ControllerIdentity {
            name: "test".to_owned(),
            metadata: None,
        },
        Time,
    )
}
async fn operate(
    controller: &Arc<ControllerUnderTest>,
    target: Target,
    action: Action,
) -> std::result::Result<Operation, Box<dyn std::error::Error>> {
    let revision = match target.fleet() {
        Some(fleet) => controller.view(fleet)?.registration.revision,
        None => 0,
    };
    let accepted = controller
        .operate(
            OperationRequest {
                id: identity::id(),
                target,
                action,
                expected_revision: revision,
                release_directory: None,
            },
            false,
        )
        .await?;
    Ok(tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let current = controller.operation(&accepted.request.id)?;
            if current.completed_at.is_some() {
                return Ok::<_, crossfire_kernel::Failure>(current);
            }
            tokio::task::yield_now().await;
        }
    })
    .await??)
}
#[tokio::test]
async fn fleet_resume_preserves_the_saved_subset_across_controller_restart()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, fleet) = setup()?;
    let first = controller(registry.clone(), host.clone())?;
    first.ready().await?;
    let fleet = first.add(&fleet)?.registration.fleet_id;
    let alpha = Target::Agent {
        fleet: fleet.clone(),
        instance: "alpha".to_owned(),
    };
    assert_eq!(
        operate(&first, alpha, Action::Start).await?.status,
        OperationStatus::Succeeded
    );
    assert_eq!(
        operate(&first, Target::Fleet(fleet.clone()), Action::Stop)
            .await?
            .status,
        OperationStatus::Succeeded
    );
    assert_eq!(
        first.view(&fleet)?.resume_instance_keys,
        Some(vec!["alpha".to_owned()])
    );
    assert!(
        first
            .view(&fleet)?
            .instances
            .iter()
            .all(|instance| !instance.desired_active && instance.phase == InstancePhase::Stopped)
    );
    first.close().await?;
    let second = controller(registry.clone(), host.clone())?;
    second.ready().await?;
    assert_eq!(
        host.0.starts.load(Ordering::SeqCst),
        1,
        "Stopped selections never restart implicitly"
    );
    assert_eq!(
        operate(&second, Target::Fleet(fleet.clone()), Action::Start)
            .await?
            .status,
        OperationStatus::Succeeded
    );
    let current = second.view(&fleet)?;
    assert!(
        current
            .instances
            .iter()
            .find(|instance| instance.instance.key == "alpha")
            .ok_or("alpha")?
            .desired_active
    );
    assert!(
        !current
            .instances
            .iter()
            .find(|instance| instance.instance.key == "beta")
            .ok_or("beta")?
            .desired_active
    );
    second.close().await?;
    let third = controller(registry, host.clone())?;
    third.ready().await?;
    assert_eq!(
        host.0.starts.load(Ordering::SeqCst),
        3,
        "Only the desired saved identity is restored"
    );
    assert_eq!(
        third.view(&fleet)?.instances[0].session_id.as_deref(),
        Some("saved-alpha")
    );
    third.close().await?;
    Ok(())
}
#[tokio::test]
async fn an_unfinished_stop_is_failed_durably_but_its_targets_stay_stopped()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, directory) = setup()?;
    let first = controller(registry.clone(), host.clone())?;
    first.ready().await?;
    let fleet = first.add(&directory)?.registration.fleet_id;
    first.close().await?;
    registry.save_desired(&[DesiredIntent {
        fleet_id: fleet.clone(),
        instance_key: "alpha".to_owned(),
    }])?;
    let pending = Operation {
        request: OperationRequest {
            id: identity::id(),
            target: Target::Fleet(fleet.clone()),
            action: Action::Stop,
            expected_revision: 0,
            release_directory: None,
        },
        status: OperationStatus::Running,
        created_at: 1,
        completed_at: None,
        approval: None,
        errors: vec![],
        receipt_pending: true,
    };
    registry.save_operation(&pending)?;
    let current = controller(registry.clone(), host.clone())?;
    current.ready().await?;
    assert_eq!(
        current.operation(&pending.request.id)?.status,
        OperationStatus::Failed
    );
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 0);
    assert!(registry.desired()?.is_empty());
    assert_eq!(
        current.view(&fleet)?.resume_instance_keys,
        Some(vec!["alpha".to_owned()])
    );
    assert!(
        !registry.prune_operations(1792000000001, 500)?,
        "Unacknowledged receipts remain pinned"
    );
    current.acknowledge_operation(&pending.request.id)?;
    registry.prune_operations(1792000000001, 500)?;
    assert!(registry.operation(&pending.request.id)?.is_none());
    current.close().await?;
    Ok(())
}
#[tokio::test]
async fn an_unproven_native_close_cannot_be_reported_stopped_or_replaced()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (_root, registry, host, directory) = setup()?;
    let current = controller(registry, host.clone())?;
    current.ready().await?;
    let fleet = current.add(&directory)?.registration.fleet_id;
    assert_eq!(
        operate(&current, Target::Fleet(fleet.clone()), Action::Start)
            .await?
            .status,
        OperationStatus::Succeeded
    );
    host.0.close_fails.store(true, Ordering::SeqCst);
    assert_eq!(
        operate(&current, Target::Fleet(fleet.clone()), Action::Stop)
            .await?
            .status,
        OperationStatus::Failed
    );
    assert_eq!(current.view(&fleet)?.phase, InstancePhase::Failed);
    let restart = current
        .operate(
            OperationRequest {
                id: identity::id(),
                target: Target::Fleet(fleet.clone()),
                action: Action::Start,
                expected_revision: 0,
                release_directory: None,
            },
            false,
        )
        .await;
    assert_eq!(
        restart.err().ok_or("Replacement must be refused")?.code,
        ErrorCode::Conflict
    );
    assert_eq!(host.0.starts.load(Ordering::SeqCst), 2);
    host.0.close_fails.store(false, Ordering::SeqCst);
    assert_eq!(
        operate(&current, Target::Fleet(fleet), Action::Stop)
            .await?
            .status,
        OperationStatus::Succeeded
    );
    current.close().await?;
    Ok(())
}
