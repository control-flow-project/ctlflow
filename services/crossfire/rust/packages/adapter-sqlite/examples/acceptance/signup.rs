use super::{Checks, SystemClock};
use crossfire_adapter_matrix::account::Authority;
use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_contracts::member::ClaimFingerprint;
use crossfire_domain::{
    identity::{Actor, Role},
    member::{invitation, signup},
    port::{AuthorizationRepository, BackendUserIdentity, CoreRepository, RepositoryAccess},
    session,
};
use crossfire_kernel::{identity, secret::Secret, time::Clock};

pub(super) async fn run(
    repository: &SharedStore,
    matrix: &Authority,
    owner: &Actor,
    clock: &SystemClock,
    checks: &mut Checks,
) -> Result<(), Box<dyn std::error::Error>> {
    let created = repository.with(|repo| {
        invitation::create(
            repo,
            owner,
            Role::Member,
            3600,
            "native-human-invite",
            clock.now()?,
        )
    })?;
    let claim = signup::Claim {
        id: created.invitation_id.clone(),
        secret: created.claim_secret,
    };
    checks.require(
        repository
            .with(|repo| invitation::verify(repo, &claim.id, &claim.secret, clock.now()?))
            .is_ok(),
        "a private human invitation is verified before native provisioning",
    )?;
    checks.require(
        repository
            .with(|repo| invitation::read(repo, owner, &claim.id, clock.now()?))?
            .claim_hash
            == identity::hash(claim.secret.expose()),
        "only the hash of the human invitation secret is persisted",
    )?;
    let details = signup::Details {
        username: "rust-invited-member".to_owned(),
        password: identity::secret()?,
        display_name: "Invited member".to_owned(),
        native: serde_json::Map::from_iter([(
            "deviceId".to_owned(),
            serde_json::json!("rust-acceptance"),
        )]),
    };
    let input = || signup::InvitationInput {
        claim: &claim,
        details: &details,
        request_id: "native-human-accept",
    };
    let accepted = signup::accept(repository, matrix, clock, &ClaimFingerprint, input()).await?;
    checks.require(
        matrix.identify(&accepted.account.access_token).await? == accepted.account.user_id,
        "invited human receives a real token for the exact new identity",
    )?;
    checks.require(
        repository
            .with(|repo| repo.member_view(&accepted.member_id))?
            .is_some_and(|member| {
                member.role.role == Role::Member
                    && member.member.display_name == details.display_name
            }),
        "invited identity has the reviewed human role and display name",
    )?;
    checks.require(
        repository
            .with(|repo| invitation::verify(repo, &claim.id, &claim.secret, clock.now()?))
            .is_err(),
        "a consumed invitation cannot be claimed again",
    )?;
    let repeated = signup::accept(repository, matrix, clock, &ClaimFingerprint, input()).await?;
    checks.require(
        repeated.member_id == accepted.member_id
            && repeated.account.user_id == accepted.account.user_id,
        "retrying identical signup details preserves the consumed native identity",
    )?;
    let changed = signup::Details {
        password: Secret::new("changed-password-0123456789".to_owned()),
        ..details
    };
    checks.require(
        signup::accept(
            repository,
            matrix,
            clock,
            &ClaimFingerprint,
            signup::InvitationInput {
                claim: &claim,
                details: &changed,
                request_id: "altered-human-accept",
            },
        )
        .await
        .is_err(),
        "a consumed signup cannot change private account details",
    )?;
    let opened = session::create(repository, matrix, &repeated.account.access_token, || {
        clock.now()
    })
    .await?;
    checks.require(
        opened.member.principal.id == accepted.member_id,
        "a newly invited native human can open an authorized management session",
    )?;
    checks.require(
        repository
            .with(|repo| session::authenticate(repo, &opened.secret, clock.now()?))?
            .member
            .principal
            .id
            == accepted.member_id,
        "management authentication resolves the same newly invited identity",
    )?;
    repository.with(|repo| session::end(repo, &opened.secret))?;
    checks.require(
        repository
            .with(|repo| session::authenticate(repo, &opened.secret, clock.now()?))
            .is_err(),
        "ending the management session invalidates only its private credential",
    )?;
    let revoked = repository.with(|repo| {
        invitation::create(
            repo,
            owner,
            Role::Member,
            3600,
            "native-revoke-invite",
            clock.now()?,
        )
    })?;
    repository.with(|repo| {
        invitation::revoke(
            repo,
            owner,
            &revoked.invitation_id,
            "native-revoke",
            clock.now()?,
        )
    })?;
    checks.require(
        repository
            .with(|repo| {
                invitation::verify(
                    repo,
                    &revoked.invitation_id,
                    &revoked.claim_secret,
                    clock.now()?,
                )
            })
            .is_err(),
        "revoked invitations are unavailable before a native account is made",
    )?;
    repository.with(|repo| {
        let mut policy = repo.policy()?.ok_or_else(|| {
            crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Unavailable,
                "Policy",
            )
        })?;
        policy.signup_mode = "open".to_owned();
        repo.save_policy(&policy)
    })?;
    let open = signup::Details {
        username: "rust-open-member".to_owned(),
        password: identity::secret()?,
        display_name: "rust-open-member".to_owned(),
        native: serde_json::Map::from_iter([(
            "deviceId".to_owned(),
            serde_json::json!("rust-open-acceptance"),
        )]),
    };
    let account = signup::register(
        repository,
        matrix,
        clock,
        signup::OpenInput {
            details: &open,
            request_id: "native-open-signup",
        },
    )
    .await?;
    checks.require(
        matrix.identify(&account.access_token).await? == account.user_id,
        "open signup provisions a real native human account",
    )?;
    checks.require(
        repository
            .with(|repo| repo.principal_by_backend_user_id(&account.user_id))?
            .is_some(),
        "open signup commits its human registration in canonical Knex SQLite",
    )?;
    checks.require(
        signup::register(
            repository,
            matrix,
            clock,
            signup::OpenInput {
                details: &open,
                request_id: "native-duplicate-signup",
            },
        )
        .await
        .is_err(),
        "open signup never adopts an already existing native account",
    )?;
    Ok(())
}
