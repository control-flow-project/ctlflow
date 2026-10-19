mod support;
use crossfire_adapter_matrix::account::{Authority, Configuration};
use crossfire_adapter_sqlite::{
    store::{SharedStore, Store},
    tables::agent_name,
};
use crossfire_domain::{
    fleet::values::Instance,
    identity::{Actor, Agent, Authentication, Principal, PrincipalKind, Role, Status, WakeMode},
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, FleetRepository,
        RepositoryAccess, UnitOfWork,
    },
    registration,
    room_access::{port::RoomRepository, service::Service, values::*},
};
use crossfire_kernel::{failure::ErrorCode, identity, secret::Secret};
use crossfire_test_support::http::Fixture;
use diesel::prelude::*;
use serde_json::{Value, json};
use support::{NOW, Scenario};

const ROOM: &str = "!room:example.test";
#[test]
fn generic_room_authority_and_storage_preserve_opaque_backend_roles()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let native = json!({"roles":["reviewer"],"scope":{"project":"credit"}})
        .as_object()
        .ok_or("access object")?
        .clone();
    let intent = Intent {
        access: Access::Custom,
        native_access: Some(native.clone()),
        muted: false,
    };
    let change = Change {
        agent_id: scenario.agent.principal_id.clone(),
        room_id: "control".to_owned(),
        expected_revision: 0,
        expected_generation: None,
        intent: intent.clone(),
    };
    let (proof, _, _) = crossfire_domain::room_access::authority::prepare(
        &mut scenario.store,
        &scenario.owner,
        &change,
        None,
        NOW,
    )?;
    crossfire_domain::room_access::authority::recheck(
        &mut scenario.store,
        &scenario.owner,
        &proof,
        NOW,
    )?;
    assert_eq!(proof.input.intent, intent);
    let grant = Grant {
        agent_id: change.agent_id.clone(),
        room_id: change.room_id.clone(),
        generation: identity::id(),
        authorizer_id: scenario.owner.principal_id.clone(),
        added_by_id: scenario.owner.principal_id.clone(),
        invitation_event_id: None,
        admission: Admission::Managed,
        intent,
        revision: 0,
        access_revision: 0,
        updated_at: NOW,
    };
    scenario.store.save_room_grant(&grant, true)?;
    let mut applied = Application::pending(&change.agent_id, &change.room_id, NOW);
    applied.native_access = Some(native);
    applied.membership = Some(crossfire_domain::messaging::Membership::Join);
    scenario.store.save_room_application(&applied, true)?;
    assert_eq!(
        scenario.store.room_grant(&change.agent_id, "control")?,
        Some(grant)
    );
    assert_eq!(
        scenario
            .store
            .room_application(&change.agent_id, "control")?,
        Some(applied)
    );
    Ok(())
}
fn authority(fixture: &Fixture) -> crossfire_kernel::Result<Authority> {
    Authority::new(Configuration {
        origin: fixture.origin.clone(),
        server_name: "example.test".to_owned(),
        jwt_secret: Secret::new("key".to_owned()),
        registration_secret: Secret::new("key".to_owned()),
        service_backend_user_id: "@service:example.test".to_owned(),
    })
}
fn state() -> Value {
    json!([
        {"type":"m.room.create","state_key":"","sender":"@owner:example.test","content":{"creator":"@owner:example.test","room_version":"10"}},
        {"type":"m.room.power_levels","state_key":"","sender":"@owner:example.test","content":{"users":{"@owner:example.test":100,"@agent:example.test":100},"events":{"m.room.message":0},"invite":50}},
        {"type":"m.room.member","state_key":"@owner:example.test","sender":"@owner:example.test","content":{"membership":"join"}},
        {"type":"m.room.member","state_key":"@agent:example.test","sender":"@owner:example.test","content":{"membership":"join"}}
    ])
}
async fn room_response(
    fixture: &mut Fixture,
    user: &str,
    cached: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let call = fixture.next().await?;
    if cached {
        assert_eq!(call.target, "/_matrix/client/v3/account/whoami");
        call.reply(200, &json!({"user_id":user}))?;
    } else {
        assert_eq!(call.target, "/_matrix/client/v3/login");
        assert_eq!(call.body["type"], "m.login.token");
        call.reply(
            200,
            &json!({"user_id":user,"access_token":"token","device_id":"CROSSFIRE_MANAGEMENT"}),
        )?;
    }
    let call = fixture.next().await?;
    assert_eq!(
        call.target,
        "/_matrix/client/v3/rooms/!room%3Aexample.test/state"
    );
    call.reply(200, &state())?;
    Ok(())
}
fn input(agent: &str, revision: i64, generation: Option<String>, access: Access) -> Change {
    Change {
        agent_id: agent.to_owned(),
        room_id: ROOM.to_owned(),
        expected_revision: revision,
        expected_generation: generation,
        intent: Intent {
            access,
            native_access: None,
            muted: false,
        },
    }
}
fn second_agent(
    store: &mut Store,
    owner: &Actor,
    fleet_id: &str,
) -> crossfire_kernel::Result<Actor> {
    let principal = Principal {
        id: identity::id(),
        backend_user_id: "@target:example.test".to_owned(),
        kind: PrincipalKind::Agent,
        status: Status::Active,
        revision: 0,
        created_at: NOW,
    };
    store.transaction(|repo| {
        registration::register(
            repo,
            &principal,
            Role::Agent,
            Some(&owner.principal_id),
            NOW,
        )?;
        repo.insert_agent(&Agent {
            principal_id: principal.id.clone(),
            owner_id: owner.principal_id.clone(),
            wake_mode: WakeMode::Humans,
        })?;
        let fleet = repo
            .fleet(fleet_id)?
            .ok_or_else(|| crossfire_kernel::Failure::new(ErrorCode::Missing, "Fleet"))?;
        repo.insert_fleet_instance(&Instance {
            owner_id: owner.principal_id.clone(),
            fleet_key: fleet.fleet_key,
            instance_key: "target".to_owned(),
            agent_id: principal.id.clone(),
            retired_at: None,
        })
    })?;
    Ok(Actor {
        principal_id: principal.id,
        kind: PrincipalKind::Agent,
        authentication: Some(Authentication::Native {
            backend_user_id: principal.backend_user_id,
        }),
    })
}
#[tokio::test]
async fn owner_grants_and_delegation_have_exact_generations_and_full_audit_provenance()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    assert_eq!(scenario.report.messages_delivered, 0);
    let mut database = scenario.database()?;
    let repository = SharedStore::new(scenario.store);
    let mut fixture = Fixture::open().await?;
    let matrix = authority(&fixture)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &repository,
        messaging: &matrix,
        clock: &clock,
    };
    let request = input(&scenario.agent.principal_id, 0, None, Access::Reply);
    assert!(
        service
            .change(&guest, &request, None, "request")
            .await
            .is_err()
    );
    let (result, protocol) = tokio::join!(
        service.change(&scenario.owner, &request, None, "request"),
        room_response(&mut fixture, "@owner:example.test", false)
    );
    protocol?;
    let changed = result?;
    let grant = changed.grant.ok_or("Grant")?;
    assert_eq!(changed.revision, 1);
    assert_eq!(grant.added_by_id, scenario.owner.principal_id);
    assert_eq!(
        repository
            .with(|repo| repo.room_application(&scenario.agent.principal_id, ROOM))?
            .ok_or("Pending application")?
            .observed_generation,
        None
    );
    let permission = PermissionChange {
        agent_id: scenario.agent.principal_id.clone(),
        room_id: ROOM.to_owned(),
        expected_revision: 1,
        expected_generation: grant.generation.clone(),
        invite_agents: true,
    };
    assert_eq!(
        service.set_permission(&scenario.owner, &permission, "request")?,
        2
    );
    assert_eq!(
        repository
            .with(|repo| repo.room_permission(&scenario.agent.principal_id, ROOM))?
            .ok_or("Permission")?
            .generation,
        grant.generation
    );
    let removed = service
        .change(
            &scenario.owner,
            &input(
                &scenario.agent.principal_id,
                2,
                Some(grant.generation.clone()),
                Access::None,
            ),
            None,
            "request",
        )
        .await?;
    assert_eq!(removed.revision, 3);
    assert!(
        repository
            .with(|repo| repo.room_permission(&scenario.agent.principal_id, ROOM))?
            .is_none()
    );
    assert!(
        service
            .set_permission(&scenario.owner, &permission, "request")
            .is_err()
    );
    let request = input(
        &scenario.agent.principal_id,
        3,
        Some(grant.generation.clone()),
        Access::Reply,
    );
    let (result, protocol) = tokio::join!(
        service.change(&scenario.owner, &request, None, "request"),
        room_response(&mut fixture, "@owner:example.test", true)
    );
    protocol?;
    let renewed = result?.grant.ok_or("Renewed grant")?;
    assert_ne!(renewed.generation, grant.generation);
    let audit: (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = crossfire_adapter_sqlite::tables::audit_event::table
        .filter(crossfire_adapter_sqlite::tables::audit_event::action.eq("room-grant.set"))
        .filter(
            crossfire_adapter_sqlite::tables::audit_event::membership_generation
                .eq(&renewed.generation),
        )
        .select((
            crossfire_adapter_sqlite::tables::audit_event::room_id,
            crossfire_adapter_sqlite::tables::audit_event::membership_generation,
            crossfire_adapter_sqlite::tables::audit_event::authorizer_id,
            crossfire_adapter_sqlite::tables::audit_event::added_by_id,
        ))
        .first(database.connection())?;
    assert_eq!(
        audit,
        (
            Some(ROOM.to_owned()),
            Some(renewed.generation),
            Some(scenario.owner.principal_id.clone()),
            Some(scenario.owner.principal_id)
        )
    );
    Ok(())
}
#[tokio::test]
async fn invited_agents_can_remove_their_own_additions_but_cannot_grant_themselves_or_delegate_permissions()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let _guest = scenario.add_human("@guest:example.test")?;
    let target = second_agent(
        &mut scenario.store,
        &scenario.owner,
        &scenario.report.controller.fleet_id,
    )?;
    let mut database = scenario.database()?;
    diesel::insert_into(agent_name::table)
        .values((
            agent_name::name.eq("target"),
            agent_name::agent_id.eq(&target.principal_id),
        ))
        .execute(database.connection())?;
    let repository = SharedStore::new(scenario.store);
    let mut fixture = Fixture::open().await?;
    let matrix = authority(&fixture)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &repository,
        messaging: &matrix,
        clock: &clock,
    };
    let owner_request = input(&scenario.agent.principal_id, 0, None, Access::Reply);
    let (result, protocol) = tokio::join!(
        service.change(&scenario.owner, &owner_request, None, "request"),
        room_response(&mut fixture, "@owner:example.test", false)
    );
    protocol?;
    let inviter = result?.grant.ok_or("Inviter grant")?;
    service.set_permission(
        &scenario.owner,
        &PermissionChange {
            agent_id: scenario.agent.principal_id.clone(),
            room_id: ROOM.to_owned(),
            expected_revision: 1,
            expected_generation: inviter.generation.clone(),
            invite_agents: true,
        },
        "request",
    )?;
    assert!(
        service
            .change(
                &scenario.agent,
                &input(
                    &scenario.agent.principal_id,
                    2,
                    Some(inviter.generation),
                    Access::Reply
                ),
                None,
                "request"
            )
            .await
            .is_err()
    );
    let request = input(&target.principal_id, 0, None, Access::Reply);
    let (result, protocol) = tokio::join!(
        service.change(&scenario.agent, &request, None, "request"),
        room_response(&mut fixture, "@agent:example.test", false)
    );
    protocol?;
    let invited = result?.grant.ok_or("Invited grant")?;
    assert_eq!(invited.added_by_id, scenario.agent.principal_id);
    let permission = PermissionChange {
        agent_id: target.principal_id.clone(),
        room_id: ROOM.to_owned(),
        expected_revision: 1,
        expected_generation: invited.generation.clone(),
        invite_agents: true,
    };
    assert_eq!(
        service
            .set_permission(&scenario.agent, &permission, "request")
            .err()
            .ok_or("No chained delegation")?
            .code,
        ErrorCode::Forbidden
    );
    let removed = service
        .change(
            &scenario.agent,
            &input(
                &target.principal_id,
                1,
                Some(invited.generation),
                Access::None,
            ),
            None,
            "request",
        )
        .await?;
    assert_eq!(removed.grant.ok_or("Removal")?.intent.access, Access::None);
    Ok(())
}
#[tokio::test]
async fn authority_changes_during_native_room_reads_roll_back_without_holding_the_repository_lock_or_accepting_stale_proofs()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let _guest = scenario.add_human("@guest:example.test")?;
    assert_eq!(scenario.report.messages_delivered, 0);
    let _metadata = scenario.database()?;
    let repository = SharedStore::new(scenario.store);
    let mut fixture = Fixture::open().await?;
    let matrix = authority(&fixture)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &repository,
        messaging: &matrix,
        clock: &clock,
    };
    let request = input(&scenario.agent.principal_id, 0, None, Access::Reply);
    let protocol = async {
        let call = fixture.next().await?;
        repository.with(|repo| {
            let mut owner = repo
                .principal(&scenario.owner.principal_id)?
                .ok_or_else(|| crossfire_kernel::Failure::new(ErrorCode::Missing, "Owner"))?;
            owner.revision += 1;
            repo.save_principal(&owner)
        })?;
        call.reply(200,&json!({"user_id":"@owner:example.test","access_token":"token","device_id":"CROSSFIRE_MANAGEMENT"}))?;
        fixture.next().await?.reply(200, &state())?;
        Ok::<(), Box<dyn std::error::Error>>(())
    };
    let (result, protocol) = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        tokio::join!(
            service.change(&scenario.owner, &request, None, "request"),
            protocol
        )
    })
    .await?;
    protocol?;
    assert_eq!(
        result.err().ok_or("Stale authority")?.code,
        ErrorCode::Conflict
    );
    assert!(
        repository
            .with(|repo| repo.room_grant(&scenario.agent.principal_id, ROOM))?
            .is_none()
    );
    Ok(())
}

#[tokio::test]
async fn native_reconciliation_preserves_a_manual_departure_instead_of_silently_joining_again()
-> Result<(), Box<dyn std::error::Error>> {
    use crossfire_adapter_runtime::room_operations::Operations;
    use crossfire_domain::room_access::reconcile;
    let mut scenario = Scenario::create()?;
    let _guest = scenario.add_human("@guest:example.test")?;
    assert_eq!(scenario.report.messages_delivered, 0);
    let _metadata = scenario.database()?;
    let repository = SharedStore::new(scenario.store);
    let mut fixture = Fixture::open().await?;
    let matrix = authority(&fixture)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &repository,
        messaging: &matrix,
        clock: &clock,
    };
    let request = input(&scenario.agent.principal_id, 0, None, Access::Reply);
    let (result, protocol) = tokio::join!(
        service.change(&scenario.owner, &request, None, "request"),
        room_response(&mut fixture, "@owner:example.test", false)
    );
    protocol?;
    let grant = result?.grant.ok_or("Grant")?;
    repository.with(|repo| {
        let mut application = repo
            .room_application(&scenario.agent.principal_id, ROOM)?
            .ok_or_else(|| crossfire_kernel::Failure::new(ErrorCode::Missing, "Application"))?;
        application.observed_generation = Some(grant.generation.clone());
        application.applied_access_revision = Some(grant.access_revision);
        application.last_success_at = Some(NOW);
        application.membership = Some(crossfire_domain::messaging::Membership::Join);
        repo.save_room_application(&application, false)
    })?;
    let mut left = state();
    left[3]["content"]["membership"] = json!("leave");
    let protocol = async {
        room_response(&mut fixture, "@owner:example.test", true).await?;
        fixture
            .next()
            .await?
            .reply(200, &json!({"user_id":"@owner:example.test"}))?;
        let call = fixture.next().await?;
        assert_eq!(call.method, "GET");
        call.reply(200, &left)?;
        Ok::<(), Box<dyn std::error::Error>>(())
    };
    let operations = Operations::default();
    let (result, protocol) = tokio::join!(
        reconcile::reconcile(
            &repository,
            &matrix,
            &operations,
            &clock,
            &scenario.agent.principal_id,
            ROOM
        ),
        protocol
    );
    protocol?;
    result?;
    let application = repository
        .with(|repo| repo.room_application(&scenario.agent.principal_id, ROOM))?
        .ok_or("Observed application")?;
    assert_eq!(
        application.membership,
        Some(crossfire_domain::messaging::Membership::Leave)
    );
    assert_eq!(application.error_code, None);
    assert_eq!(application.observed_generation, Some(grant.generation));
    Ok(())
}

#[tokio::test]
async fn private_owner_rooms_cannot_be_removed_muted_or_delegated_even_by_the_owner()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let _guest = scenario.add_human("@guest:example.test")?;
    assert_eq!(scenario.report.messages_delivered, 0);
    let _metadata = scenario.database()?;
    let repository = SharedStore::new(scenario.store);
    repository.with(|repo| {
        repo.transaction(|repo| {
            repo.save_room_grant(
                &Grant {
                    agent_id: scenario.agent.principal_id.clone(),
                    room_id: ROOM.to_owned(),
                    generation: identity::id(),
                    authorizer_id: scenario.owner.principal_id.clone(),
                    added_by_id: scenario.owner.principal_id.clone(),
                    invitation_event_id: None,
                    admission: Admission::Managed,
                    intent: Intent {
                        access: Access::Reply,
                        native_access: None,
                        muted: false,
                    },
                    revision: 0,
                    access_revision: 0,
                    updated_at: NOW,
                },
                true,
            )?;
            repo.insert_owner_conversation(&OwnerConversation {
                agent_id: scenario.agent.principal_id.clone(),
                owner_id: scenario.owner.principal_id.clone(),
                room_id: ROOM.to_owned(),
                created_at: NOW,
            })
        })
    })?;
    let fixture = Fixture::open().await?;
    let matrix = authority(&fixture)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &repository,
        messaging: &matrix,
        clock: &clock,
    };
    let request = input(&scenario.agent.principal_id, 0, None, Access::None);
    assert_eq!(
        service
            .change(&scenario.owner, &request, None, "request")
            .await
            .err()
            .ok_or("Private room removal")?
            .code,
        ErrorCode::Forbidden
    );
    let mut request = input(&scenario.agent.principal_id, 0, None, Access::Reply);
    request.intent.muted = true;
    assert_eq!(
        service
            .change(&scenario.owner, &request, None, "request")
            .await
            .err()
            .ok_or("Private room mute")?
            .code,
        ErrorCode::Forbidden
    );
    let permission = PermissionChange {
        agent_id: scenario.agent.principal_id.clone(),
        room_id: ROOM.to_owned(),
        expected_revision: 0,
        expected_generation: identity::id(),
        invite_agents: true,
    };
    assert_eq!(
        service
            .set_permission(&scenario.owner, &permission, "request")
            .err()
            .ok_or("Private room invitation delegation")?
            .code,
        ErrorCode::Forbidden
    );
    Ok(())
}
