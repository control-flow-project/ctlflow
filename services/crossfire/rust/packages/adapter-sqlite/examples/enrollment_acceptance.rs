use crossfire_adapter_http::NativeHttp;
use crossfire_adapter_matrix::account::{Authority, Configuration};
use crossfire_adapter_runtime::room_operations::Operations;
use crossfire_adapter_sqlite::store::{SharedStore, Store};
use crossfire_contracts::{enrollment::Digest, identity::IntentHash};
use crossfire_domain::{
    enrollment::{decide, exchange, introduce, values::*},
    identity::{Actor, Authentication, PrincipalKind, Status},
    matrix::Membership,
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, CredentialRepository,
        MatrixIdentity, RepositoryAccess,
    },
    principal, registration,
    room_access::{
        invitation, owner_conversation,
        port::RoomRepository,
        service::Service,
        values::{Access, Change, Intent},
    },
};
use crossfire_kernel::{identity, secret::Secret, time::Clock};
use crossfire_test_support::{input::private_configuration, sqlite::PreparedDatabase};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tokio_util::sync::CancellationToken;
#[path = "acceptance/notice.rs"]
mod notices;
#[path = "acceptance/signup.rs"]
mod signup;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    origin: String,
    server_name: String,
    jwt_secret: String,
    registration_secret: String,
    owner: String,
    owner_token: String,
    outsider: String,
    agent: String,
}
struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> crossfire_kernel::Result<i64> {
        identity::now()
    }
}
struct Checks {
    count: usize,
}
impl Checks {
    fn require(&mut self, condition: bool, label: &str) -> Result<(), Box<dyn std::error::Error>> {
        if !condition {
            return Err(format!("Native enrollment acceptance failed: {label}").into());
        }
        self.count += 1;
        Ok(())
    }
}
#[tokio::main(worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input: Input = private_configuration(16384)?;
    let prepared = PreparedDatabase::copy()?;
    let mut store = Store::open(prepared.path())?;
    let now = identity::now()?;
    registration::initialize(&mut store, &input.owner, now)?;
    eprintln!("Native acceptance: initialized prepared management state");
    let owner = Actor {
        principal_id: store
            .principal_by_matrix_id(&input.owner)?
            .ok_or("Owner")?
            .id,
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Native {
            matrix_user_id: input.owner.clone(),
        }),
    };
    let repository = SharedStore::new(store);
    let operations = Operations::default();
    let clock = SystemClock;
    let matrix = Authority::new(Configuration {
        origin: input.origin.clone(),
        server_name: input.server_name.clone(),
        jwt_secret: Secret::new(input.jwt_secret),
        registration_secret: Secret::new(input.registration_secret),
        service_matrix_id: input.owner.clone(),
    })?;
    let cancellation = CancellationToken::new();
    let http = NativeHttp::new(&input.origin, cancellation.clone())?;
    let native_token = Secret::new(input.owner_token);
    let mut policy = crossfire_domain::coordination::Policy::owner_default(&input.owner);
    policy.invite_agents = true;
    let input_roster = Introduction {
        enrollment_id: identity::id(),
        claim_secret: identity::secret()?,
        roster: Roster {
            owner_matrix_id: input.owner.clone(),
            fleet_key: "native-fleet".to_owned(),
            controller: Controller {
                name: "Native acceptance controller".to_owned(),
                metadata: BTreeMap::new(),
            },
            controller_credential: None,
            instances: vec![Entry {
                instance_key: "native".to_owned(),
                name: "native-specialist".to_owned(),
                identity: None,
                policy,
            }],
        },
    };
    let digest = Digest::new()?;
    let hasher = IntentHash;
    let mut checks = Checks { count: 0 };
    let receipt = introduce::introduce(&repository, &matrix, &digest, &input_roster, now).await?;
    eprintln!("Native acceptance: introduced owner-reviewed enrollment");
    checks.require(
        receipt.request.state == State::Pending,
        "new accounts require human enrollment approval",
    )?;
    checks.require(
        receipt
            == introduce::introduce(&repository, &matrix, &digest, &input_roster, now + 1).await?,
        "request retry retains reviewed bytes and private claims",
    )?;
    let decision = Decision {
        expected_revision: 0,
        approve: true,
        verification_code: receipt.request.verification_code,
    };
    repository.with(|repo| {
        decide::decide(
            repo,
            &owner,
            &input_roster.enrollment_id,
            &decision,
            "native-approval",
            &input.server_name,
            now + 2,
        )
    })?;
    let exchange = repository.with(|repo| {
        exchange::exchange(
            repo,
            &input_roster.enrollment_id,
            &input_roster.claim_secret,
            now + 3,
        )
    })?;
    checks.require(
        exchange.status == "provisioning" && exchange.instances[0].account.is_none(),
        "unprovisioned accounts never expose credentials",
    )?;
    let agent = exchange.instances[0].agent_id.clone();
    eprintln!("Native acceptance: approved enrollment");
    principal::reconcile(&repository, &matrix, &operations, &clock, &hasher, &agent).await?;
    eprintln!("Native acceptance: reconciled the native account");
    let ready = repository.with(|repo| {
        exchange::exchange(
            repo,
            &input_roster.enrollment_id,
            &input_roster.claim_secret,
            clock.now()?,
        )
    })?;
    let account = ready.instances[0]
        .account
        .as_ref()
        .ok_or("Native account is not ready")?;
    checks.require(
        ready.status == "ready",
        "real Conduit account reconciliation becomes ready",
    )?;
    checks.require(
        crossfire_domain::port::MatrixIdentity::identify(&matrix, &account.access_token).await?
            == account.matrix_user_id,
        "exchanged token belongs to the exact native agent",
    )?;
    checks.require(
        matrix
            .profile_name(&account.matrix_user_id)
            .await?
            .as_deref()
            == Some("native-specialist (rust-owner)"),
        "native display name uses role and owner identity",
    )?;
    checks.require(
        ready.fleet.as_ref().is_some_and(|fleet| fleet.1.is_some()),
        "approved controller receives its private exact credential",
    )?;
    let actor = Actor {
        principal_id: agent.clone(),
        kind: PrincipalKind::Agent,
        authentication: Some(Authentication::Native {
            matrix_user_id: account.matrix_user_id.clone(),
        }),
    };
    checks.require(
        repository
            .with(|repo| repo.owner_conversation(&agent))?
            .is_none(),
        "provisioning does not preemptively create a conversation",
    )?;
    let private =
        owner_conversation::ensure(&repository, &matrix, &operations, &clock, &agent, None).await?;
    eprintln!("Native acceptance: established the private owner conversation");
    checks.require(
        private
            == owner_conversation::ensure(&repository, &matrix, &operations, &clock, &agent, None)
                .await?,
        "repeating private conversation creation preserves its exact native room",
    )?;
    matrix
        .verify_owner_conversation(&input.owner, &account.matrix_user_id, &private)
        .await?;
    checks.require(
        repository
            .with(|repo| repo.room_permission(&agent, &private))?
            .is_none(),
        "owner DM never delegates fleet invitation permissions",
    )?;
    let created = http
        .ok(
            Some(&native_token),
            Method::POST,
            "/_matrix/client/v3/createRoom",
            Some(&json!({"name":"Native reviewed room","preset":"private_chat"})),
        )
        .await?;
    let group = created
        .get("room_id")
        .and_then(Value::as_str)
        .ok_or("Created native room")?
        .to_owned();
    matrix
        .invite(&input.owner, &group, &account.matrix_user_id)
        .await?;
    checks.require(
        invitation::accept(
            &repository,
            &matrix,
            &operations,
            &clock,
            invitation::Request {
                receiver: &actor,
                agent: &agent,
                room: &group,
                request_id: "accept-native",
            },
        )
        .await?,
        "owner invitation joins through current domain and native authority",
    )?;
    checks.require(
        matrix
            .membership(&input.owner, &account.matrix_user_id, &group)
            .await?
            .membership
            == Membership::Join,
        "real native membership confirms the join",
    )?;
    let grant = repository
        .with(|repo| repo.room_grant(&agent, &group))?
        .ok_or("Room grant")?;
    checks.require(
        grant.intent.access == Access::Reply && grant.authorizer_id == owner.principal_id,
        "native invitation retains exact owner provenance",
    )?;
    let permission = repository
        .with(|repo| repo.room_permission(&agent, &group))?
        .ok_or("Fleet room invitation permission")?;
    checks.require(
        permission.generation == grant.generation,
        "owner reviewed fleet invitation policy is generation scoped",
    )?;
    checks.require(
        !invitation::accept(
            &repository,
            &matrix,
            &operations,
            &clock,
            invitation::Request {
                receiver: &actor,
                agent: &agent,
                room: &group,
                request_id: "repeat",
            },
        )
        .await?,
        "an already accepted native invite is not replayed",
    )?;
    notices::run(
        notices::Context {
            repository: &repository,
            matrix: &matrix,
            http: &http,
            clock: &clock,
            actor: &actor,
            group: &group,
            user: &account.matrix_user_id,
            owner: &input.owner,
            outsider: &input.outsider,
        },
        &mut checks,
    )
    .await?;
    let view = repository
        .with(|repo| repo.agent_view(&agent))?
        .ok_or("Agent")?;
    let service = Service {
        repository: &repository,
        matrix: &matrix,
        clock: &clock,
    };
    let removed = service
        .change(
            &owner,
            &Change {
                agent_id: agent.clone(),
                room_id: group.clone(),
                expected_revision: view.principal.revision,
                expected_generation: Some(grant.generation.clone()),
                intent: Intent {
                    access: Access::None,
                    power: None,
                    muted: false,
                },
            },
            None,
            "remove-native",
        )
        .await?;
    crossfire_domain::room_access::reconcile::reconcile(
        &repository,
        &matrix,
        &operations,
        &clock,
        &agent,
        &group,
    )
    .await?;
    checks.require(
        !matrix
            .joined(&account.matrix_user_id)
            .await?
            .contains(&group),
        "revoked native room access leaves the room",
    )?;
    checks.require(
        repository
            .with(|repo| repo.room_permission(&agent, &group))?
            .is_none(),
        "revocation removes generation-bound permissions",
    )?;
    checks.require(
        removed
            .grant
            .is_some_and(|removed| removed.generation == grant.generation),
        "removal retains the provenance generation until readmission",
    )?;
    principal::reconcile(&repository, &matrix, &operations, &clock, &hasher, &agent).await?;
    let same = repository
        .with(|repo| repo.agent_credential(&agent))?
        .ok_or("Credential")?;
    checks.require(
        same.access_token.as_ref() == Some(&account.access_token),
        "routine reconciliation retains the actual native login",
    )?;
    checks.require(
        repository
            .with(|repo| repo.owner_conversation(&agent))?
            .is_some_and(|conversation| conversation.room_id == private),
        "routine account application preserves private room identity",
    )?;
    let mut renamed = Introduction {
        enrollment_id: identity::id(),
        claim_secret: identity::secret()?,
        roster: input_roster.roster.clone(),
    };
    renamed.roster.controller_credential = ready.fleet.as_ref().and_then(|fleet| fleet.1.clone());
    renamed.roster.instances[0].name = "native-renamed-high".to_owned();
    renamed.roster.instances[0].identity = Some(IdentityProof {
        agent_id: agent.clone(),
        access_token: account.access_token.clone(),
    });
    let reviewed =
        introduce::introduce(&repository, &matrix, &digest, &renamed, clock.now()?).await?;
    checks.require(
        reviewed.request.state == State::Pending
            && reviewed.instances[0].current_name.as_deref() == Some("native-specialist"),
        "existing identity renames require fresh human review",
    )?;
    repository.with(|repo| {
        decide::decide(
            repo,
            &owner,
            &renamed.enrollment_id,
            &Decision {
                expected_revision: 0,
                approve: true,
                verification_code: reviewed.request.verification_code,
            },
            "native-rename",
            &input.server_name,
            clock.now()?,
        )
    })?;
    principal::reconcile(&repository, &matrix, &operations, &clock, &hasher, &agent).await?;
    checks.require(
        matrix
            .profile_name(&account.matrix_user_id)
            .await?
            .as_deref()
            == Some("native-renamed-high (rust-owner)"),
        "approved rename changes the actual native profile",
    )?;
    checks.require(
        repository
            .with(|repo| repo.owner_conversation(&agent))?
            .is_some_and(|conversation| conversation.room_id == private),
        "approved rename preserves the native private conversation",
    )?;
    checks.require(
        repository
            .with(|repo| repo.agent_credential(&agent))?
            .is_some_and(|credential| {
                credential.access_token.as_ref() == Some(&account.access_token)
            }),
        "approved rename preserves the native login",
    )?;
    let repeated = Introduction {
        enrollment_id: identity::id(),
        claim_secret: identity::secret()?,
        roster: renamed.roster,
    };
    let unchanged =
        introduce::introduce(&repository, &matrix, &digest, &repeated, clock.now()?).await?;
    checks.require(
        unchanged.request.state == State::Approved,
        "an unchanged already-approved roster does not ask for redundant consent",
    )?;
    repository.with(|repo| {
        let mut principal = repo.principal(&agent)?.ok_or_else(|| {
            crossfire_kernel::Failure::new(crossfire_kernel::failure::ErrorCode::Missing, "Agent")
        })?;
        principal.status = Status::Revoked;
        principal.revision += 1;
        repo.save_principal(&principal)
    })?;
    principal::reconcile(&repository, &matrix, &operations, &clock, &hasher, &agent).await?;
    checks.require(
        repository
            .with(|repo| repo.agent_credential(&agent))?
            .is_some_and(|credential| credential.access_token.is_none()),
        "revocation clears stored native credentials",
    )?;
    checks.require(
        repository
            .with(|repo| repo.application(&agent))?
            .is_some_and(|application| application.applied_status == Some(Status::Revoked)),
        "revocation records native confirmation",
    )?;
    checks.require(
        exchange::exchange(
            &mut Store::open(prepared.path())?,
            &input_roster.enrollment_id,
            &input_roster.claim_secret,
            clock.now()?,
        )
        .is_err(),
        "revoked agent accounts cannot be exchanged",
    )?;
    checks.require(
        !matrix.exists(&input.agent).await?,
        "enrollment never creates unrelated identities",
    )?;
    checks.require(
        matrix
            .verify_owner_conversation(&input.outsider, &account.matrix_user_id, &private)
            .await
            .is_err(),
        "unrelated users cannot adopt the private owner conversation",
    )?;
    checks.require(
        matrix
            .identify(&account.access_token)
            .await
            .err()
            .is_some_and(|error| error.code == crossfire_kernel::failure::ErrorCode::Unauthorized),
        "revoked native token cannot identify the agent",
    )?;
    signup::run(
        &repository,
        &matrix,
        &owner,
        &input.server_name,
        &input.owner,
        &clock,
        &mut checks,
    )
    .await?;
    matrix.close();
    operations.close();
    cancellation.cancel();
    println!(
        "{{\"status\":\"passed\",\"assertions\":{},\"provider\":\"pinned native Conduit and Knex SQLite\"}}",
        checks.count
    );
    Ok(())
}
