use crossfire_adapter_sqlite::store::{SharedStore, Store};
use crossfire_domain::{
    agent::{self, WakePolicyChange},
    fleet::{
        authority, control,
        values::{Credential, Fleet, FleetActor, Instance},
    },
    identity::{Actor, Agent, Authentication, Principal, PrincipalKind, Role, Status, WakeMode},
    port::{
        AgentRepository, AuthorizationRepository, FleetRepository, RepositoryAccess, UnitOfWork,
    },
    registration,
    wake::Sender,
};
use crossfire_kernel::{Result, failure::ErrorCode, identity, secret::Secret};
use crossfire_test_support::sqlite::PreparedDatabase;

const NOW: i64 = 1_792_000_000_000;

fn owner(store: &mut Store) -> std::result::Result<Actor, Box<dyn std::error::Error>> {
    registration::initialize(store, "@owner:example.test", "@owner:example.test", NOW)?;
    let principal = store
        .principal_by_backend_user_id("@owner:example.test")?
        .ok_or("Missing owner")?;
    Ok(Actor {
        principal_id: principal.id,
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Native {
            backend_user_id: "@owner:example.test".to_owned(),
        }),
    })
}

fn fleet(store: &mut Store, actor: &Actor) -> Result<Fleet> {
    let fleet = Fleet {
        id: identity::id(),
        owner_id: actor.principal_id.clone(),
        fleet_key: "fixture".to_owned(),
        archived_at: None,
        delivery_enabled: true,
        label: "Fixture fleet".to_owned(),
        controller_name: "Fixture controller".to_owned(),
        revision: 0,
        created_at: NOW,
        updated_at: NOW,
    };
    store.insert_fleet(&fleet)?;
    Ok(fleet)
}

fn agent(store: &mut Store, actor: &Actor, fleet: &Fleet) -> Result<Principal> {
    let principal = Principal {
        id: identity::id(),
        backend_user_id: "@agent:example.test".to_owned(),
        kind: PrincipalKind::Agent,
        status: Status::Active,
        revision: 0,
        created_at: NOW,
    };
    store.transaction(|store| {
        registration::register(
            store,
            &principal,
            Role::Agent,
            Some(&actor.principal_id),
            NOW,
        )?;
        store.insert_agent(&Agent {
            principal_id: principal.id.clone(),
            owner_id: actor.principal_id.clone(),
            wake_mode: WakeMode::Humans,
        })?;
        store.insert_fleet_instance(&Instance {
            owner_id: actor.principal_id.clone(),
            fleet_key: fleet.fleet_key.clone(),
            instance_key: "agent".to_owned(),
            agent_id: principal.id.clone(),
            retired_at: None,
        })
    })?;
    Ok(principal)
}

#[test]
fn controller_credentials_leases_and_delivery_revisions_are_scoped_and_transactional()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let database = PreparedDatabase::copy()?;
    let mut store = Store::open(database.path())?;
    let actor = owner(&mut store)?;
    let fleet = fleet(&mut store, &actor)?;
    let credential_id = identity::id();
    let token = authority::controller_token(&credential_id, &Secret::new("claim".to_owned()));
    store.insert_fleet_credential(&Credential {
        id: credential_id.clone(),
        fleet_id: fleet.id.clone(),
        secret_hash: identity::hash(token.expose()),
        created_at: NOW,
        revoked_at: None,
    })?;
    let controller = authority::authenticate_controller(&mut store, &token)?;
    assert_eq!(
        controller,
        FleetActor::Controller {
            fleet_id: fleet.id.clone(),
            credential_id
        }
    );
    assert!(
        authority::authenticate_controller(
            &mut store,
            &Secret::new(format!("{}x", token.expose()))
        )
        .is_err()
    );
    let connection = identity::id();
    let view =
        control::report_connection(&mut store, &controller, &fleet.id, &connection, false, NOW)?;
    assert!(view.connection.online);
    assert_eq!(
        control::report_connection(
            &mut store,
            &controller,
            &fleet.id,
            &identity::id(),
            false,
            NOW + 1
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    assert!(
        control::live_connection(&mut store, &controller, &fleet.id, &connection, NOW + 29999)
            .is_ok()
    );
    assert!(
        control::live_connection(&mut store, &controller, &fleet.id, &connection, NOW + 30000)
            .is_err()
    );
    assert!(
        control::report_connection(
            &mut store,
            &controller,
            &fleet.id,
            &connection,
            false,
            NOW + 30000
        )
        .is_err()
    );
    let replacement = identity::id();
    control::report_connection(
        &mut store,
        &controller,
        &fleet.id,
        &replacement,
        false,
        NOW + 30000,
    )?;
    assert!(
        control::report_connection(
            &mut store,
            &controller,
            &fleet.id,
            &connection,
            true,
            NOW + 30001
        )
        .is_err()
    );
    let stopped = control::report_connection(
        &mut store,
        &controller,
        &fleet.id,
        &replacement,
        true,
        NOW + 30001,
    )?;
    assert!(!stopped.connection.online);
    assert!(
        control::report_connection(
            &mut store,
            &controller,
            &fleet.id,
            &replacement,
            false,
            NOW + 30002
        )
        .is_err()
    );
    let changed = control::change_delivery(
        &mut store,
        &controller,
        &fleet.id,
        0,
        false,
        "delivery",
        NOW,
    )?;
    assert!(!changed.delivery_enabled);
    assert_eq!(changed.revision, 1);
    assert_eq!(
        control::change_delivery(
            &mut store,
            &FleetActor::Principal(actor),
            &fleet.id,
            0,
            true,
            "stale",
            NOW
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::StaleRevision)
    );
    assert!(
        !store
            .fleet(&fleet.id)?
            .ok_or("Missing fleet")?
            .delivery_enabled
    );
    Ok(())
}

#[test]
fn agent_account_and_wake_policy_changes_preserve_owner_and_revision_guards()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let database = PreparedDatabase::copy()?;
    let mut store = Store::open(database.path())?;
    let actor = owner(&mut store)?;
    let fleet = fleet(&mut store, &actor)?;
    let principal = agent(&mut store, &actor, &fleet)?;
    let valid = WakePolicyChange {
        expected_revision: 0,
        mode: WakeMode::Humans,
        senders: vec![Sender {
            principal_id: actor.principal_id.clone(),
            include_agents: true,
        }],
    };
    let policy = agent::change_wake_policy(&mut store, &actor, &principal.id, &valid, "wake", NOW)?;
    assert_eq!(policy.revision, 1);
    assert_eq!(store.wake_senders(&principal.id)?, valid.senders);
    let duplicate = WakePolicyChange {
        expected_revision: 1,
        mode: WakeMode::Selected,
        senders: vec![valid.senders[0].clone(), valid.senders[0].clone()],
    };
    assert!(
        agent::change_wake_policy(
            &mut store,
            &actor,
            &principal.id,
            &duplicate,
            "duplicate",
            NOW
        )
        .is_err()
    );
    let self_wake = WakePolicyChange {
        expected_revision: 1,
        mode: WakeMode::Selected,
        senders: vec![Sender {
            principal_id: principal.id.clone(),
            include_agents: false,
        }],
    };
    assert!(
        agent::change_wake_policy(&mut store, &actor, &principal.id, &self_wake, "self", NOW)
            .is_err()
    );
    assert_eq!(store.wake_senders(&principal.id)?, valid.senders);
    assert_eq!(
        store
            .principal(&principal.id)?
            .ok_or("Missing agent")?
            .revision,
        1
    );
    let cleared = WakePolicyChange {
        expected_revision: 1,
        mode: WakeMode::Everyone,
        senders: vec![],
    };
    agent::change_wake_policy(&mut store, &actor, &principal.id, &cleared, "all", NOW)?;
    assert!(store.wake_senders(&principal.id)?.is_empty());
    let changed = agent::change(
        &mut store,
        &actor,
        &principal.id,
        2,
        Some(Status::Revoked),
        "revoke",
        NOW + 1,
    )?;
    assert_eq!(changed.principal.status, Status::Revoked);
    assert_eq!(changed.application.next_check_at, NOW + 1);
    assert!(
        agent::change(
            &mut store,
            &actor,
            &principal.id,
            3,
            Some(Status::Active),
            "restore",
            NOW + 1
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn listener_reports_require_exact_controller_generation_and_keep_closed_runs_closed()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    use crossfire_domain::{
        listener::{self, Proof, Report},
        port::ListenerRepository,
    };
    let database = PreparedDatabase::copy()?;
    let mut store = Store::open(database.path())?;
    let actor = owner(&mut store)?;
    let fleet = fleet(&mut store, &actor)?;
    let principal = agent(&mut store, &actor, &fleet)?;
    let receiver = Actor {
        principal_id: principal.id.clone(),
        kind: PrincipalKind::Agent,
        authentication: Some(Authentication::Native {
            backend_user_id: principal.backend_user_id,
        }),
    };
    let credential_id = identity::id();
    let token = authority::controller_token(&credential_id, &Secret::new("claim".to_owned()));
    store.insert_fleet_credential(&Credential {
        id: credential_id,
        fleet_id: fleet.id.clone(),
        secret_hash: identity::hash(token.expose()),
        created_at: NOW,
        revoked_at: None,
    })?;
    let controller = authority::authenticate_controller(&mut store, &token)?;
    let connection_id = identity::id();
    let mut report = Report {
        run_id: identity::id(),
        release: "release-current".to_owned(),
        messages_delivered: 0,
        statistics: None,
        stopped: false,
        controller: Proof {
            fleet_id: fleet.id.clone(),
            connection_id: connection_id.clone(),
            credential: token,
        },
    };
    assert!(
        listener::report(
            &mut store,
            &receiver,
            &principal.id,
            &report,
            "release-current",
            NOW
        )
        .is_err()
    );
    control::report_connection(
        &mut store,
        &controller,
        &fleet.id,
        &connection_id,
        false,
        NOW,
    )?;
    let outcome = listener::report(
        &mut store,
        &receiver,
        &principal.id,
        &report,
        "release-current",
        NOW,
    )?;
    assert!(!outcome.disconnect);
    assert_eq!(store.active_listener_count(&principal.id, NOW - 1, NOW)?, 1);
    assert_eq!(store.active_listener_count(&principal.id, NOW, NOW)?, 0);
    report.messages_delivered = 3;
    listener::report(
        &mut store,
        &receiver,
        &principal.id,
        &report,
        "release-current",
        NOW + 1000,
    )?;
    let saved = store.listener_run(&report.run_id)?.ok_or("Missing run")?;
    assert_eq!(saved.active_ms, 1000);
    assert_eq!(saved.messages_delivered, 3);
    report.messages_delivered = 1;
    report.release = "release-changed".to_owned();
    assert!(
        listener::report(
            &mut store,
            &receiver,
            &principal.id,
            &report,
            "release-current",
            NOW + 2000
        )
        .is_err()
    );
    assert_eq!(
        store
            .listener_run(&report.run_id)?
            .ok_or("Missing run")?
            .last_seen_at,
        NOW + 1000
    );
    report.release = "release-current".to_owned();
    let outcome = listener::report(
        &mut store,
        &receiver,
        &principal.id,
        &report,
        "release-newer",
        NOW + 30000,
    )?;
    assert!(outcome.disconnect);
    assert_eq!(
        store
            .listener_run(&report.run_id)?
            .ok_or("Missing run")?
            .messages_delivered,
        3
    );
    report.stopped = true;
    listener::report(
        &mut store,
        &receiver,
        &principal.id,
        &report,
        "release-newer",
        NOW + 30001,
    )?;
    report.stopped = false;
    let closed = listener::report(
        &mut store,
        &receiver,
        &principal.id,
        &report,
        "release-newer",
        NOW + 30002,
    )?;
    assert!(closed.closed);
    assert!(closed.disconnect);
    assert_eq!(
        store
            .listener_run(&report.run_id)?
            .ok_or("Missing run")?
            .stopped_at,
        Some(NOW + 30001)
    );
    Ok(())
}

#[tokio::test]
async fn management_sessions_expire_revoke_and_keep_native_tokens_private()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    use crossfire_domain::{port::BackendUserIdentity, session};
    struct Matrix;
    impl BackendUserIdentity for Matrix {
        async fn identify(&self, _token: &Secret) -> Result<String> {
            Ok("@owner:example.test".to_owned())
        }
    }
    let database = PreparedDatabase::copy()?;
    let mut store = Store::open(database.path())?;
    owner(&mut store)?;
    let token = Secret::new("private-native-token".to_owned());
    let repository = SharedStore::new(store);
    let first = session::create(&repository, &Matrix, &token, || Ok(NOW)).await?;
    assert!(
        repository
            .with(|store| store.session(first.secret.expose()))?
            .is_none()
    );
    let authenticated =
        repository.with(|store| session::authenticate(store, &first.secret, NOW))?;
    assert_eq!(
        authenticated.native_access_token.expose(),
        "private-native-token"
    );
    assert_eq!(authenticated.csrf_secret, first.csrf_secret);
    assert!(
        repository
            .with(|store| session::authenticate(store, &first.secret, NOW + 8 * 3600 * 1000))
            .is_err()
    );
    for _session in 1..10 {
        session::create(&repository, &Matrix, &token, || Ok(NOW)).await?;
    }
    assert_eq!(
        session::create(&repository, &Matrix, &token, || Ok(NOW))
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Limit)
    );
    repository.with(|store| session::end(store, &first.secret))?;
    assert!(
        repository
            .with(|store| session::authenticate(store, &first.secret, NOW))
            .is_err()
    );
    session::create(&repository, &Matrix, &token, || Ok(NOW)).await?;
    Ok(())
}
