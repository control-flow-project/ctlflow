use crate::{
    authorization::active_actor,
    identity::{Actor, Authentication, MemberSession, MemberView, PrincipalKind, Status},
    permission::Permission,
    port::{AuthorizationRepository, CoreRepository, MatrixIdentity, RepositoryAccess, UnitOfWork},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};

pub struct Opened {
    pub secret: Secret,
    pub csrf_secret: Secret,
    pub member: MemberView,
    pub permissions: Vec<Permission>,
}

pub async fn create<A: RepositoryAccess>(
    repository: &A,
    matrix: &impl MatrixIdentity,
    token: &Secret,
    clock: impl Fn() -> Result<i64>,
) -> Result<Opened>
where
    A::Repository: CoreRepository,
{
    let matrix_id = matrix.identify(token).await?;
    repository.with(|repo| {
        repo.transaction(|repo| {
            let now = clock()?;
            let principal = repo
                .principal_by_matrix_id(&matrix_id)?
                .filter(|value| {
                    value.kind == PrincipalKind::Human && value.status == Status::Active
                })
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Forbidden,
                        "An active human membership is required",
                    )
                })?;
            let member = repo.member_view(&principal.id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "An active human membership is required",
                )
            })?;
            repo.remove_expired_sessions(now)?;
            if repo.session_count(&principal.id, now)? >= 10 {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "End an existing management session before opening another",
                ));
            }
            let secret = identity::secret()?;
            let csrf_secret = identity::secret()?;
            let expires_at = now
                .checked_add(8 * 60 * 60 * 1000)
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Invalid session clock"))?;
            repo.insert_session(&MemberSession {
                secret_hash: identity::hash(secret.expose()),
                member_id: principal.id.clone(),
                csrf_secret: csrf_secret.clone(),
                native_access_token: token.clone(),
                created_at: now,
                expires_at,
            })?;
            let permissions = repo.permissions(&principal.id)?;
            Ok(Opened {
                secret,
                csrf_secret,
                member,
                permissions,
            })
        })
    })
}

pub struct Authenticated {
    pub actor: Actor,
    pub member: MemberView,
    pub csrf_secret: Secret,
    pub native_access_token: Secret,
    pub permissions: Vec<Permission>,
}

pub fn authenticate(
    repo: &mut impl CoreRepository,
    secret: &Secret,
    now: i64,
) -> Result<Authenticated> {
    let session = repo
        .session(&identity::hash(secret.expose()))?
        .filter(|session| session.expires_at > now)
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Unauthorized,
                "Management session expired or ended",
            )
        })?;
    let actor = Actor {
        principal_id: session.member_id.clone(),
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Management {
            session_hash: session.secret_hash,
        }),
    };
    active_actor(repo, &actor, now)?;
    let member = repo.member_view(&actor.principal_id)?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Forbidden,
            "An active human membership is required",
        )
    })?;
    let permissions = repo.permissions(&actor.principal_id)?;
    Ok(Authenticated {
        actor,
        member,
        csrf_secret: session.csrf_secret,
        native_access_token: session.native_access_token,
        permissions,
    })
}

pub fn end(repo: &mut impl CoreRepository, secret: &Secret) -> Result<()> {
    repo.remove_session(&identity::hash(secret.expose()))
}
