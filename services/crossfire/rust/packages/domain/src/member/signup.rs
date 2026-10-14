use super::invitation::{Invitation, InvitationRepository};
use crate::{
    identity::{Member, Principal, PrincipalKind, Role, Status},
    matrix::{Account, MatrixAuthority},
    port::{
        Audit, AuditActor, AuthorizationRepository, CoreRepository, RepositoryAccess, UnitOfWork,
    },
    registration,
};
use crossfire_kernel::{
    Failure, Result, failure::ErrorCode, identity, secret::Secret, time::Clock,
};
pub struct Details {
    pub username: String,
    pub password: Secret,
    pub display_name: String,
    pub device_id: String,
}
pub struct Claim {
    pub id: String,
    pub secret: Secret,
}
pub struct Instance<'a> {
    pub server_name: &'a str,
    pub service_matrix_id: &'a str,
}
pub struct Accepted {
    pub member_id: String,
    pub account: Account,
}
pub trait Fingerprint {
    fn fingerprint(
        &self,
        claim: &Secret,
        matrix_user_id: &str,
        password: &Secret,
        display_name: &str,
    ) -> Result<String>;
}
fn username(value: &str) -> bool {
    (1..=100).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
        && value.bytes().all(|value| {
            value.is_ascii_lowercase() || value.is_ascii_digit() || b"._=-".contains(&value)
        })
}
fn native_identity(instance: Instance<'_>, details: &Details, open: bool) -> Result<String> {
    if !username(&details.username)
        || open && details.username.starts_with("agent-")
        || !(12..=1024).contains(&details.password.expose().encode_utf16().count())
        || details.display_name.is_empty()
        || details.display_name.encode_utf16().count() > 100
        || details
            .display_name
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
        || open && (details.device_id.is_empty() || details.device_id.encode_utf16().count() > 100)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            if open {
                "Choose a valid username and a password of at least 12 characters"
            } else {
                "Invalid human account details"
            },
        ));
    }
    let user = format!("@{}:{}", details.username, instance.server_name);
    if user == instance.service_matrix_id || details.username == "conduit" {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Reserved native identity",
        ));
    }
    Ok(user)
}
fn usable(
    invitation: Option<Invitation>,
    claim: &Secret,
    now: i64,
    message: &str,
) -> Result<Invitation> {
    invitation
        .filter(|value| {
            value.revoked_at.is_none()
                && value.expires_at > now
                && identity::matches(claim.expose(), &value.claim_hash)
        })
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, message))
}
fn audit(id: &str, request: &str, action: &str, now: i64) -> Audit {
    Audit {
        actor: AuditActor::Anonymous,
        request_id: request.to_owned(),
        target_kind: "member".to_owned(),
        target_id: id.to_owned(),
        owner_id: Some(id.to_owned()),
        action: action.to_owned(),
        message: String::new(),
        created_at: now,
        room_id: None,
        membership_generation: None,
        authorizer_id: None,
        added_by_id: None,
        permission_code: None,
    }
}
pub struct InvitationInput<'a> {
    pub claim: &'a Claim,
    pub details: &'a Details,
    pub instance: Instance<'a>,
    pub request_id: &'a str,
}
pub async fn accept<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    hasher: &impl Fingerprint,
    input: InvitationInput<'_>,
) -> Result<Accepted>
where
    A::Repository: InvitationRepository,
{
    let user = native_identity(input.instance, input.details, false)?;
    let fingerprint = hasher.fingerprint(
        &input.claim.secret,
        &user,
        &input.details.password,
        &input.details.display_name,
    )?;
    let initial = repository.with(|repo| {
        usable(
            repo.member_invitation(&input.claim.id)?,
            &input.claim.secret,
            clock.now()?,
            "Invalid or expired invitation",
        )
    })?;
    if let Some(member_id) = initial.consumed_by_member_id {
        if initial.claim_fingerprint.as_ref() != Some(&fingerprint) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Invitation was consumed with different account details",
            ));
        }
        let account = matrix
            .provision(&user, &input.details.password, &input.details.device_id)
            .await?;
        return Ok(Accepted { member_id, account });
    }
    if initial.claim_matrix_user_id.is_none() && matrix.exists(&user).await? {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Native username is already registered",
        ));
    }
    repository.with(|repo| {
        repo.transaction(|repo| {
            let mut current = usable(
                repo.member_invitation(&input.claim.id)?,
                &input.claim.secret,
                clock.now()?,
                "Invitation is no longer usable",
            )?;
            if current.consumed_by_member_id.is_some() {
                return Err(Failure::new(
                    ErrorCode::Unauthorized,
                    "Invitation is no longer usable",
                ));
            }
            if current.claim_matrix_user_id.is_some() {
                return if current.claim_fingerprint.as_ref() == Some(&fingerprint) {
                    Ok(())
                } else {
                    Err(Failure::new(
                        ErrorCode::Conflict,
                        "Invitation is reserved for different account details",
                    ))
                };
            }
            if repo.principal_by_matrix_id(&user)?.is_some()
                || repo.invitation_by_claim(&user)?.is_some()
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Identity is already reserved or registered",
                ));
            }
            current.claim_matrix_user_id = Some(user.clone());
            current.claim_display_name = Some(input.details.display_name.clone());
            current.claim_fingerprint = Some(fingerprint.clone());
            repo.save_member_invitation(&current, false)
        })
    })?;
    let account = matrix
        .provision(&user, &input.details.password, &input.details.device_id)
        .await?;
    repository.with(|repo| {
        repo.transaction(|repo| {
            let now = clock.now()?;
            let mut current = repo
                .member_invitation(&input.claim.id)?
                .filter(|value| {
                    value.revoked_at.is_none()
                        && value.expires_at > now
                        && value.claim_fingerprint.as_ref() == Some(&fingerprint)
                })
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Conflict,
                        "Invitation changed during native provisioning; cleanup is pending",
                    )
                })?;
            if let Some(member_id) = current.consumed_by_member_id {
                return Ok(Accepted { member_id, account });
            }
            let member_id = identity::id();
            registration::register(
                repo,
                &Principal {
                    id: member_id.clone(),
                    matrix_user_id: user,
                    kind: PrincipalKind::Human,
                    status: Status::Active,
                    revision: 0,
                    created_at: now,
                },
                current.role,
                Some(&current.created_by_member_id),
                now,
            )?;
            repo.insert_member(&Member {
                principal_id: member_id.clone(),
                display_name: input.details.display_name.clone(),
            })?;
            current.consumed_by_member_id = Some(member_id.clone());
            repo.save_member_invitation(&current, false)?;
            repo.audit(&audit(
                &member_id,
                input.request_id,
                "member-invitation.accept",
                now,
            ))?;
            Ok(Accepted { member_id, account })
        })
    })
}
pub struct OpenInput<'a> {
    pub details: &'a Details,
    pub instance: Instance<'a>,
    pub request_id: &'a str,
}
pub async fn register<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    input: OpenInput<'_>,
) -> Result<Account>
where
    A::Repository: InvitationRepository,
{
    let user = native_identity(input.instance, input.details, true)?;
    if repository
        .with(|repo| repo.policy())?
        .is_none_or(|policy| policy.signup_mode != "open")
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "An invitation link is required to create an account",
        ));
    }
    if matrix.exists(&user).await? {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "This username is already registered",
        ));
    }
    let account = matrix
        .provision(&user, &input.details.password, &input.details.device_id)
        .await?;
    let result = repository.with(|repo| {
        repo.transaction(|repo| {
            if repo
                .policy()?
                .is_none_or(|policy| policy.signup_mode != "open")
            {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Open signup was disabled during registration",
                ));
            }
            if repo.principal_by_matrix_id(&user)?.is_some() {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "This account is already registered",
                ));
            }
            let now = clock.now()?;
            let id = identity::id();
            registration::register(
                repo,
                &Principal {
                    id: id.clone(),
                    matrix_user_id: user.clone(),
                    kind: PrincipalKind::Human,
                    status: Status::Active,
                    revision: 0,
                    created_at: now,
                },
                Role::Member,
                None,
                now,
            )?;
            repo.insert_member(&Member {
                principal_id: id.clone(),
                display_name: input.details.username.clone(),
            })?;
            repo.audit(&audit(&id, input.request_id, "member.register", now))
        })
    });
    match result {
        Ok(()) => Ok(account),
        Err(error) => {
            matrix.discard(&user).await.map_err(|_| {
                Failure::new(
                    ErrorCode::Native,
                    "Registration could not finish; native account cleanup failed",
                )
            })?;
            Err(error)
        }
    }
}
pub async fn reclaim<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
) -> Result<()>
where
    A::Repository: InvitationRepository,
{
    for claim in repository.with(|repo| repo.abandoned_invitation_claims(clock.now()?))? {
        if let Some(user) = &claim.claim_matrix_user_id {
            if matrix.discard(user).await.is_err() {
                continue;
            }
            repository.with(|repo| {
                repo.transaction(|repo| {
                    if let Some(mut current) =
                        repo.member_invitation(&claim.id)?.filter(|current| {
                            current.consumed_by_member_id.is_none()
                                && current.claim_fingerprint == claim.claim_fingerprint
                        })
                    {
                        current.claim_matrix_user_id = None;
                        current.claim_display_name = None;
                        current.claim_fingerprint = None;
                        repo.save_member_invitation(&current, false)?;
                    }
                    Ok(())
                })
            })?;
        }
    }
    Ok(())
}
