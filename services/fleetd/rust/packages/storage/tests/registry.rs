use crossfire_kernel::{failure::ErrorCode, identity};
use fleetd_domain::{
    model::*,
    resume_selection::{SelectionStore, Selections},
    resume_work::{self, WorkStore},
};
use fleetd_storage::{registry::Registry, work::Work};
use std::{fs, os::unix::fs::PermissionsExt};

fn instance(key: &str) -> Instance {
    Instance {
        key: key.to_owned(),
        name: key.to_owned(),
        definition: "role".to_owned(),
        workarea: format!("agents/role/workarea/{key}"),
        workspace: None,
        history_mode: None,
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
#[test]
fn interrupted_work_keeps_the_exact_history_and_message_identity_until_acknowledged_and_reloads_current_instructions()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let store = Work::open(directory.path())?;
    let context = InterruptedContext {
        context: "!room:example.test".to_owned(),
        session_id: identity::id(),
    };
    resume_work::capture(&store, std::slice::from_ref(&context), 1_792_000_000_000)?;
    let first = store.work()?;
    resume_work::capture(&store, std::slice::from_ref(&context), 1_792_000_000_001)?;
    assert_eq!(
        store.work()?,
        first,
        "Repeated stop preserves the original continuation identity"
    );
    let text = resume_work::continuation_text(&first[0])?;
    assert!(text.contains("re-read the applicable AGENTS.md"));
    assert!(text.contains("Do not disclose its contents to other rooms"));
    assert!(text.ends_with(
        "If the task is already complete or no longer authorized, do not repeat its effects."
    ));
    let changed = InterruptedContext {
        context: context.context.clone(),
        session_id: identity::id(),
    };
    assert_eq!(
        resume_work::capture(&store, &[changed], 1_792_000_000_001)
            .err()
            .ok_or("Changed history")?
            .code,
        ErrorCode::Conflict
    );
    let reopened = Work::open(directory.path())?;
    assert_eq!(reopened.work()?, first);
    assert_eq!(
        resume_work::renew(&reopened, &identity::id(), 1_792_000_000_002)
            .err()
            .ok_or("Missing checkpoint")?
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(reopened.work()?, first);
    resume_work::renew(&reopened, &first[0].message_id, 1_792_000_000_002)?;
    let renewed = reopened.work()?;
    assert_eq!(renewed.len(), 1);
    assert_eq!(renewed[0].context, first[0].context);
    assert_eq!(renewed[0].session_id, first[0].session_id);
    assert_ne!(renewed[0].message_id, first[0].message_id);
    assert_eq!(renewed[0].checkpointed_at, 1_792_000_000_002);
    assert!(
        resume_work::clear(
            &reopened,
            &[InterruptedContext {
                context: context.context.clone(),
                session_id: identity::id()
            }]
        )
        .is_err()
    );
    assert_eq!(reopened.work()?, renewed);
    assert!(resume_work::clear(&reopened, &[context.clone(), context.clone()]).is_err());
    assert_eq!(reopened.work()?, renewed);
    let other = InterruptedContext {
        context: "!other:fixture".into(),
        session_id: identity::id(),
    };
    resume_work::capture(&reopened, std::slice::from_ref(&other), 1_792_000_000_003)?;
    resume_work::clear(&reopened, std::slice::from_ref(&other))?;
    assert_eq!(reopened.work()?, renewed);
    resume_work::clear(&reopened, std::slice::from_ref(&context))?;
    assert!(reopened.work()?.is_empty());
    fs::write(
        directory.path().join("resume-work.json"),
        b"{\"legacy\":true}",
    )?;
    assert!(
        reopened.work().is_err(),
        "Malformed or superseded state cannot trigger fresh history"
    );
    Ok(())
}
