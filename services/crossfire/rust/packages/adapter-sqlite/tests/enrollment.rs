mod support;
use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_contracts::enrollment::Digest;
use crossfire_domain::{
    coordination::Policy,
    enrollment::{port::EnrollmentRepository, preflight, values::*},
    identity::Status,
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, CredentialRepository,
        MatrixIdentity, RepositoryAccess,
    },
};
use crossfire_domain::{
    enrollment::{decide, exchange, expire, introduce, read},
    port::UnitOfWork,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicUsize, Ordering},
};
use support::NOW;
use support::Scenario;

struct Native {
    calls: AtomicUsize,
    identity: String,
}
impl MatrixIdentity for Native {
    async fn identify(&self, _token: &Secret) -> Result<String> {
        self.calls.fetch_add(1, Ordering::AcqRel);
        Ok(self.identity.clone())
    }
}
fn roster(owner: &str, name: &str) -> Roster {
    Roster {
        controller: Controller {
            name: "Owned controller".to_owned(),
            metadata: BTreeMap::new(),
        },
        controller_credential: None,
        owner_matrix_id: owner.to_owned(),
        fleet_key: "new-fleet".to_owned(),
        instances: vec![Entry {
            instance_key: "worker".to_owned(),
            name: name.to_owned(),
            identity: None,
            policy: Policy::owner_default(owner),
        }],
    }
}

fn introduction(name: &str) -> Result<Introduction> {
    Ok(Introduction {
        enrollment_id: crossfire_kernel::identity::id(),
        claim_secret: crossfire_kernel::identity::secret()?,
        roster: roster("@owner:example.test", name),
    })
}
#[tokio::test]
async fn enrollment_is_repeatable_owner_reviewed_atomic_and_exchanges_only_ready_current_native_accounts()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let scenario = Scenario::create()?;
    let owner = scenario.owner.clone();
    let mut input = introduction("new-agent")?;
    input.roster.instances[0].policy.invite_agents = true;
    let digest = Digest::new()?;
    let native = Native {
        calls: AtomicUsize::new(0),
        identity: "@agent:example.test".to_owned(),
    };
    let repository = SharedStore::new(scenario.store);
    let first = introduce::introduce(&repository, &native, &digest, &input, NOW).await?;
    assert_eq!(first.request.state, State::Pending);
    assert_eq!(first.request.verification_code.len(), 12);
    assert_eq!(first.instances[0].item.outcome, Outcome::Claimed);
    assert_eq!(first.instances[0].current_name, None);
    assert_eq!(
        first,
        introduce::introduce(&repository, &native, &digest, &input, NOW + 1).await?
    );
    assert_eq!(
        repository.with(|repo| repo.pending_identity_count(None))?,
        1
    );
    let wrong = Decision {
        expected_revision: 0,
        approve: true,
        verification_code: "wrong".to_owned(),
    };
    assert_eq!(
        repository
            .with(|repo| decide::decide(
                repo,
                &owner,
                &input.enrollment_id,
                &wrong,
                "request",
                "example.test",
                NOW + 2
            ))
            .err()
            .ok_or("Wrong code")?
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(repository.with(|repo| repo.enrolled_agent_count(None))?, 1);
    let good = Decision {
        verification_code: first.request.verification_code.clone(),
        ..wrong
    };
    let approved = repository.with(|repo| {
        decide::decide(
            repo,
            &owner,
            &input.enrollment_id,
            &good,
            "request",
            "example.test",
            NOW + 3,
        )
    })?;
    assert_eq!(approved.state, State::Approved);
    assert_eq!(approved.revision, 1);
    assert_eq!(repository.with(|repo| repo.enrolled_agent_count(None))?, 2);
    assert_eq!(
        repository.with(|repo| repo.pending_identity_count(None))?,
        0
    );
    let pending = repository.with(|repo| {
        exchange::exchange(repo, &input.enrollment_id, &input.claim_secret, NOW + 4)
    })?;
    assert_eq!(pending.status, "provisioning");
    assert!(pending.instances[0].account.is_none());
    let id = pending.instances[0].agent_id.clone();
    repository.with(|repo| {
        repo.transaction(|repo| {
            let view = repo
                .agent_view(&id)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent"))?;
            let mut application = view.application;
            application.applied_status = Some(Status::Active);
            application.native_display_name = Some(crossfire_domain::identity::agent_display_name(
                "new-agent",
                &view.owner_member.display_name,
            ));
            application.error_code = None;
            repo.save_application(&application)?;
            let mut credential = repo
                .agent_credential(&id)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Credential"))?;
            credential.access_token = Some(Secret::new("ready-private-native-token".to_owned()));
            repo.save_agent_credential(&credential)
        })
    })?;
    let ready = repository.with(|repo| {
        exchange::exchange(repo, &input.enrollment_id, &input.claim_secret, NOW + 5)
    })?;
    assert_eq!(ready.status, "ready");
    assert_eq!(
        ready.instances[0]
            .account
            .as_ref()
            .ok_or("Account")?
            .access_token
            .expose(),
        "ready-private-native-token"
    );
    assert_eq!(
        repository
            .with(|repo| read::read(repo, &owner, &input.enrollment_id, NOW + 5))?
            .instances[0]
            .current_name
            .as_deref(),
        Some("new-agent")
    );
    repository.with(|repo| {
        let mut principal = repo
            .principal(&id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent"))?;
        principal.status = Status::Suspended;
        repo.save_principal(&principal)
    })?;
    assert_eq!(
        repository
            .with(|repo| exchange::exchange(
                repo,
                &input.enrollment_id,
                &input.claim_secret,
                NOW + 6
            ))
            .err()
            .ok_or("Suspended identity")?
            .code,
        ErrorCode::Forbidden
    );
    assert_eq!(native.calls.load(Ordering::Acquire), 0);
    assert_eq!(scenario.report.messages_delivered, 0);
    assert_eq!(
        scenario.agent.kind,
        crossfire_domain::identity::PrincipalKind::Agent
    );
    Ok(())
}
#[tokio::test]
async fn enrollment_expiration_releases_names_and_rejection_never_creates_agents()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let scenario = Scenario::create()?;
    let owner = scenario.owner.clone();
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        17
    );
    let repository = SharedStore::new(scenario.store);
    let native = Native {
        calls: AtomicUsize::new(0),
        identity: "@agent:example.test".to_owned(),
    };
    let digest = Digest::new()?;
    let input = introduction("expiring")?;
    let receipt = introduce::introduce(&repository, &native, &digest, &input, NOW).await?;
    repository
        .with(|repo| repo.transaction(|repo| expire::expire(repo, receipt.request.expires_at)))?;
    assert_eq!(
        repository
            .with(|repo| repo.enrollment_request(&input.enrollment_id))?
            .ok_or("Expired request")?
            .state,
        State::Expired
    );
    assert!(
        repository
            .with(|repo| repo.name_claim("expiring"))?
            .is_none()
    );
    let input = introduction("expiring")?;
    let receipt = introduce::introduce(&repository, &native, &digest, &input, NOW + 10).await?;
    repository.with(|repo| {
        decide::decide(
            repo,
            &owner,
            &input.enrollment_id,
            &Decision {
                expected_revision: 0,
                approve: false,
                verification_code: receipt.request.verification_code,
            },
            "reject",
            "example.test",
            NOW + 11,
        )
    })?;
    assert_eq!(
        repository
            .with(|repo| repo.enrollment_request(&input.enrollment_id))?
            .ok_or("Rejected")?
            .state,
        State::Rejected
    );
    assert!(
        repository
            .with(|repo| repo.name_claim("expiring"))?
            .is_none()
    );
    assert_eq!(repository.with(|repo| repo.enrolled_agent_count(None))?, 1);
    assert_eq!(repository.with(|repo| repo.pending_enrollment_count())?, 0);
    assert_eq!(scenario.report.messages_delivered, 0);
    assert_eq!(
        scenario.agent.kind,
        crossfire_domain::identity::PrincipalKind::Agent
    );
    Ok(())
}
#[tokio::test]
async fn global_name_collisions_reject_an_entire_fleet_with_an_explicit_error_before_native_work_or_database_changes()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let mut metadata = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(metadata.connection(), "user_version")?,
        17
    );
    assert_eq!(scenario.report.messages_delivered, 0);
    let repository = SharedStore::new(scenario.store);
    let native = Native {
        calls: AtomicUsize::new(0),
        identity: "@agent:example.test".to_owned(),
    };
    for owner in ["@owner:example.test", "@guest:example.test"] {
        let input = roster(owner, "agent");
        let error = preflight::preflight(&repository, &native, &input)
            .await
            .err()
            .ok_or("Name collision")?;
        assert_eq!(error.code, ErrorCode::NameCollision);
        assert_eq!(error.message, "Name collision: agent");
    }
    assert_eq!(native.calls.load(Ordering::Acquire), 0);
    assert_eq!(repository.with(|repo| repo.enrolled_agent_count(None))?, 1);
    assert_eq!(
        repository.with(|repo| repo.pending_identity_count(None))?,
        0
    );
    assert_eq!(
        repository.with(|repo| repo.enrolled_agent_count(Some(&guest.principal_id)))?,
        0
    );
    assert!(repository.with(|repo| repo.name_claim("agent"))?.is_some());
    Ok(())
}
#[tokio::test]
async fn existing_fleet_identity_requires_matching_private_proof_exact_native_identity_and_current_controller()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let _guest = scenario.add_human("@guest:example.test")?;
    let credential = scenario.report.controller.credential.clone();
    let repository = SharedStore::new(scenario.store);
    let native = Native {
        calls: AtomicUsize::new(0),
        identity: "@agent:example.test".to_owned(),
    };
    let mut input = roster("@owner:example.test", "agent");
    input.fleet_key = "fixture".to_owned();
    input.instances[0].instance_key = "agent".to_owned();
    input.controller_credential = Some(credential);
    assert_eq!(
        preflight::preflight(&repository, &native, &input)
            .await
            .err()
            .ok_or("Missing identity proof")?
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(native.calls.load(Ordering::Acquire), 0);
    input.instances[0].identity = Some(IdentityProof {
        agent_id: scenario.agent.principal_id.clone(),
        access_token: Secret::new("private-token".to_owned()),
    });
    let verified = preflight::preflight(&repository, &native, &input).await?;
    assert_eq!(verified.existing.len(), 1);
    assert!(verified.existing[0].operational);
    assert_eq!(verified.existing[0].agent_id, scenario.agent.principal_id);
    assert_eq!(native.calls.load(Ordering::Acquire), 1);
    let foreign = Native {
        calls: AtomicUsize::new(0),
        identity: "@another:example.test".to_owned(),
    };
    assert_eq!(
        preflight::preflight(&repository, &foreign, &input)
            .await
            .err()
            .ok_or("Wrong native identity")?
            .code,
        ErrorCode::Forbidden
    );
    let mut policy = repository.with(|repo| repo.policy())?.ok_or("Policy")?;
    policy.max_agents = 1;
    policy.max_owner_agents = 1;
    repository.with(|repo| repo.save_policy(&policy))?;
    assert_eq!(
        preflight::preflight(
            &repository,
            &native,
            &roster("@owner:example.test", "new-worker")
        )
        .await
        .err()
        .ok_or("Capacity")?
        .code,
        ErrorCode::Capacity
    );
    preflight::preflight(&repository, &native, &input).await?;
    repository.with(|repo| {
        let mut principal = repo
            .principal(&scenario.agent.principal_id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent"))?;
        principal.status = Status::Revoked;
        repo.save_principal(&principal)
    })?;
    assert_eq!(
        preflight::preflight(&repository, &native, &input)
            .await
            .err()
            .ok_or("Revoked proof")?
            .code,
        ErrorCode::Forbidden
    );
    Ok(())
}
