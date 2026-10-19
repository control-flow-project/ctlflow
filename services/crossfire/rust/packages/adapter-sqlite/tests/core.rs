use crossfire_adapter_sqlite::store::Store;
use crossfire_domain::{
    identity::{Actor, Authentication, Member, Principal, PrincipalKind, Role, Status},
    member, policy,
    port::{AuthorizationRepository, CoreRepository, UnitOfWork},
    registration,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

const NOW: i64 = 1_792_000_000_000;

#[test]
fn management_authentication_uses_opaque_backend_identities()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut fixture = fixture()?;
    registration::initialize(
        &mut fixture.store,
        "person/東京",
        "Independent administrator",
        NOW,
    )?;
    let principal = fixture
        .store
        .principal_by_backend_user_id("person/東京")?
        .ok_or("Missing principal")?;
    let actor = Actor {
        principal_id: principal.id,
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Native {
            backend_user_id: "person/東京".to_owned(),
        }),
    };
    assert_eq!(
        policy::read(&mut fixture.store, &actor, NOW)?.max_message_bytes,
        65536
    );
    let mut foreign = actor.clone();
    foreign.authentication = Some(Authentication::Native {
        backend_user_id: "person/other".to_owned(),
    });
    assert!(policy::read(&mut fixture.store, &foreign, NOW).is_err());
    Ok(())
}

struct Fixture {
    store: Store,
    _directory: tempfile::TempDir,
}

fn fixture() -> std::result::Result<Fixture, Box<dyn std::error::Error>> {
    use std::{fs, os::unix::fs::PermissionsExt};
    let template = std::env::var_os("CROSSFIRE_TEST_DATABASE_TEMPLATE")
        .ok_or("Prepare the shared Knex test database and set CROSSFIRE_TEST_DATABASE_TEMPLATE before storage acceptance")?;
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let path = directory.path().join("management.sqlite");
    fs::copy(template, &path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    let store = Store::open(&path)?;
    Ok(Fixture {
        store,
        _directory: directory,
    })
}

fn administrator(store: &mut Store) -> Result<Actor> {
    registration::initialize(store, "@admin:example.test", "admin", NOW)?;
    let principal = store
        .principal_by_backend_user_id("@admin:example.test")?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Administrator fixture missing"))?;
    Ok(Actor {
        principal_id: principal.id,
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Native {
            backend_user_id: "@admin:example.test".to_owned(),
        }),
    })
}

#[test]
fn canonical_identity_authority_and_policy_are_transactional()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut fixture = fixture()?;
    let store = &mut fixture.store;
    assert_eq!(
        store.schema_identity()?,
        (
            1_129_465_426,
            crossfire_adapter_sqlite::schema::SCHEMA_VERSION
        )
    );
    let actor = administrator(store)?;
    registration::initialize(store, "@admin:example.test", "admin", NOW)?;
    assert_eq!(store.active_administrator_count()?, 1);
    let default = policy::read(store, &actor, NOW)?;
    assert_eq!(default.max_message_bytes, 65536);
    assert_eq!(default.fleet_idle_timeout_seconds, 1800);
    let mut changed = default.clone();
    changed.max_message_bytes = 131072;
    assert_eq!(
        policy::change(store, &actor, &changed, "policy-check", NOW)?,
        1
    );
    assert!(policy::change(store, &actor, &changed, "stale-check", NOW).is_err());
    let revoked = member::Change {
        expected_revision: 0,
        status: Some(Status::Revoked),
        display_name: None,
        role: None,
    };
    assert!(
        member::change(
            store,
            &actor,
            &actor.principal_id,
            &revoked,
            "last-admin",
            NOW
        )
        .is_err()
    );
    assert_eq!(store.active_administrator_count()?, 1);
    let mut impostor = actor.clone();
    impostor.authentication = Some(Authentication::Native {
        backend_user_id: "@impostor:example.test".to_owned(),
    });
    assert!(policy::read(store, &impostor, NOW).is_err());
    Ok(())
}

#[test]
fn expected_failures_and_nested_savepoints_preserve_exact_data()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut fixture = fixture()?;
    let store = &mut fixture.store;
    let actor = administrator(store)?;
    let result: Result<()> = store.transaction(|store| {
        let member = Member {
            principal_id: actor.principal_id.clone(),
            display_name: "temporary".to_owned(),
        };
        store.save_member(&member)?;
        Err(Failure::new(ErrorCode::Conflict, "Expected rejection"))
    });
    assert!(result.is_err());
    assert_eq!(
        store
            .member_view(&actor.principal_id)?
            .map(|value| value.member.display_name),
        Some("admin".to_owned())
    );
    store.transaction(|store| {
        store.save_member(&Member {
            principal_id: actor.principal_id.clone(),
            display_name: "outer".to_owned(),
        })?;
        let rejected: Result<()> = store.transaction(|store| {
            store.save_member(&Member {
                principal_id: actor.principal_id.clone(),
                display_name: "inner".to_owned(),
            })?;
            Err(Failure::new(ErrorCode::Conflict, "Reject inner only"))
        });
        assert!(rejected.is_err());
        assert_eq!(
            store
                .member_view(&actor.principal_id)?
                .map(|value| value.member.display_name),
            Some("outer".to_owned())
        );
        Ok(())
    })?;
    assert_eq!(
        store
            .member_view(&actor.principal_id)?
            .map(|value| value.member.display_name),
        Some("outer".to_owned())
    );
    Ok(())
}

#[test]
fn native_int64_and_normalized_roles_survive_reopen()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let path = fixture.path().join("private/management.sqlite");
    use std::{fs, os::unix::fs::PermissionsExt};
    let directory = path.parent().ok_or("Missing private fixture directory")?;
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    fs::copy(
        std::env::var_os("CROSSFIRE_TEST_DATABASE_TEMPLATE")
            .ok_or("Prepare the shared Knex test database template")?,
        &path,
    )?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    let id = "78a6a2d2-46d6-4c89-8cfc-895866e6935b";
    {
        let mut store = Store::open(&path)?;
        store.transaction(|store| {
            registration::register(
                store,
                &Principal {
                    id: id.to_owned(),
                    backend_user_id: "@native:example.test".to_owned(),
                    kind: PrincipalKind::Human,
                    status: Status::Active,
                    revision: 0,
                    created_at: 9_007_199_254_741_099,
                },
                Role::Member,
                None,
                NOW,
            )?;
            store.insert_member(&Member {
                principal_id: id.to_owned(),
                display_name: "Native".to_owned(),
            })
        })?;
    }
    let mut reopened = Store::open(&path)?;
    assert_eq!(
        reopened.principal(id)?.map(|value| value.created_at),
        Some(9_007_199_254_741_099)
    );
    assert_eq!(
        reopened
            .permissions(id)?
            .iter()
            .filter(|permission| permission.code() == "principal.read")
            .count(),
        1
    );
    Ok(())
}
