use crossfire_kernel::identity;
use fleetd_domain::{
    model::*,
    resume_selection::{SelectionStore, Selections},
};
use fleetd_storage::registry::Registry;
use std::{fs, os::unix::fs::PermissionsExt};

fn instance(key: &str) -> Instance {
    Instance {
        key: key.to_owned(),
        name: key.to_owned(),
        definition: "role".to_owned(),
        workarea: format!("agents/role/workarea/{key}"),
        workspace: None,
        history_mode: None,
        mirror_output: None,
        runtime_options: None,
    }
}
#[test]
fn durable_stop_selection_preserves_active_instances_and_does_not_wake_every_stopped_agent_after_restart()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let registry = Registry::open(directory.path())?;
    let fleet_id = identity::id();
    let record = Registration {
        fleet_id: fleet_id.clone(),
        fleet_key: "fleet".to_owned(),
        directory: directory.path().to_owned(),
        label: "Fleet".to_owned(),
        revision: 0,
        digest: "0".repeat(64),
    };
    registry.save_registrations(std::slice::from_ref(&record))?;
    let catalog = vec![instance("alpha"), instance("beta")];
    let mut selections = Selections::load(&registry, std::slice::from_ref(&record))?;
    assert_eq!(selections.select(&fleet_id, &catalog, &[])?.len(), 2);
    selections.stop(&fleet_id, &["alpha".to_owned()], None)?;
    selections.stop(&fleet_id, &[], None)?;
    assert_eq!(selections.view(&fleet_id), Some(vec!["alpha".to_owned()]));
    let reopened = Registry::open(directory.path())?;
    let mut resumed = Selections::load(&reopened, std::slice::from_ref(&record))?;
    assert_eq!(resumed.select(&fleet_id, &catalog, &[])?[0].key, "alpha");
    assert_eq!(
        resumed
            .select(&fleet_id, &catalog, &["beta".to_owned()])?
            .len(),
        2
    );
    assert!(
        resumed.select(&fleet_id, &catalog[1..], &[]).is_err(),
        "Never silently drop a missing saved target"
    );
    resumed.stop(&fleet_id, &[], Some("alpha"))?;
    assert!(
        resumed.select(&fleet_id, &catalog, &[])?.is_empty(),
        "An explicit empty selection is not missing state"
    );
    resumed.forget(&fleet_id, None)?;
    assert_eq!(resumed.select(&fleet_id, &catalog, &[])?.len(), 2);
    let desired = vec![DesiredIntent {
        fleet_id: fleet_id.clone(),
        instance_key: "alpha".to_owned(),
    }];
    registry.save_desired(&desired)?;
    assert_eq!(registry.desired()?, desired);
    assert!(
        registry
            .save_desired(&[desired[0].clone(), desired[0].clone()])
            .is_err()
    );
    assert_eq!(
        registry.desired()?,
        desired,
        "Rejected writes do not replace persisted intent"
    );
    assert_eq!(reopened.registrations()?, vec![record]);
    let invalid = vec![ResumeSelection {
        fleet_id: identity::id(),
        instance_keys: vec![],
    }];
    registry.save_resume_selections(&invalid)?;
    assert!(Selections::load(&registry, &reopened.registrations()?).is_err());
    Ok(())
}
