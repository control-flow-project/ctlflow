use crate::{
    authorization::authorize,
    identity::{Actor, Page, Role},
    permission::Permission,
    port::{Audit, CoreRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invitation {
    pub id: String,
    pub created_by_member_id: String,
    pub claim_hash: String,
    pub role: Role,
    pub created_at: i64,
    pub expires_at: i64,
    pub consumed_by_member_id: Option<String>,
    pub revoked_at: Option<i64>,
    pub claim_matrix_user_id: Option<String>,
    pub claim_display_name: Option<String>,
    pub claim_fingerprint: Option<String>,
}
pub trait InvitationRepository: CoreRepository {
    fn member_invitation(&mut self, id: &str) -> Result<Option<Invitation>>;
    fn save_member_invitation(&mut self, value: &Invitation, insert: bool) -> Result<()>;
    fn member_invitations_page(
        &mut self,
        creator: Option<&str>,
        page: i64,
        size: i64,
    ) -> Result<Page<Invitation>>;
    fn invitation_by_claim(&mut self, matrix_id: &str) -> Result<Option<Invitation>>;
    fn abandoned_invitation_claims(&mut self, now: i64) -> Result<Vec<Invitation>>;
}
pub struct Created {
    pub invitation_id: String,
    pub claim_secret: Secret,
    pub expires_at: i64,
}
pub fn authority(repo: &mut impl InvitationRepository, actor: &Actor, now: i64) -> Result<bool> {
    authorize(repo, actor, Permission::MemberInvite, now)?;
    let administrator = repo
        .permissions(&actor.principal_id)?
        .contains(&Permission::MemberManage);
    if !administrator
        && repo
            .policy()?
            .is_none_or(|policy| policy.invitation_issuers != "members")
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only administrators may invite members",
        ));
    }
    Ok(administrator)
}
pub fn create(
    repo: &mut impl InvitationRepository,
    actor: &Actor,
    role: Role,
    lifetime: i64,
    request_id: &str,
    now: i64,
) -> Result<Created> {
    if !(60..=604800).contains(&lifetime) || role == Role::Agent {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invitation lifetime must be 60–604800 seconds",
        ));
    }
    repo.transaction(|repo| {
        let administrator = authority(repo, actor, now)?;
        if !administrator && role != Role::Member {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Only administrators may invite administrators",
            ));
        }
        let id = identity::id();
        let claim_secret = identity::secret()?;
        let expires_at = now.checked_add(lifetime * 1000).ok_or_else(|| {
            Failure::new(ErrorCode::Limit, "Invitation expiry exceeds native range")
        })?;
        repo.save_member_invitation(
            &Invitation {
                id: id.clone(),
                created_by_member_id: actor.principal_id.clone(),
                claim_hash: identity::hash(claim_secret.expose()),
                role,
                created_at: now,
                expires_at,
                consumed_by_member_id: None,
                revoked_at: None,
                claim_matrix_user_id: None,
                claim_display_name: None,
                claim_fingerprint: None,
            },
            true,
        )?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "member-invitation",
            &id,
            "member-invitation.create",
            None,
            now,
        ))?;
        Ok(Created {
            invitation_id: id,
            claim_secret,
            expires_at,
        })
    })
}
pub fn read(
    repo: &mut impl InvitationRepository,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<Invitation> {
    let administrator = authority(repo, actor, now)?;
    repo.member_invitation(id)?
        .filter(|invitation| administrator || invitation.created_by_member_id == actor.principal_id)
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Invitation not found"))
}
pub fn list(
    repo: &mut impl InvitationRepository,
    actor: &Actor,
    page: i64,
    size: i64,
    now: i64,
) -> Result<Page<Invitation>> {
    let administrator = authority(repo, actor, now)?;
    repo.member_invitations_page(
        if administrator {
            None
        } else {
            Some(&actor.principal_id)
        },
        page,
        size,
    )
}
pub fn revoke(
    repo: &mut impl InvitationRepository,
    actor: &Actor,
    id: &str,
    request: &str,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        let mut invitation = read(repo, actor, id, now)?;
        if invitation.consumed_by_member_id.is_some() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Invitation is already consumed",
            ));
        }
        invitation.revoked_at = Some(invitation.revoked_at.unwrap_or(now));
        repo.save_member_invitation(&invitation, false)?;
        repo.audit(&Audit::new(
            actor,
            request,
            "member-invitation",
            id,
            "member-invitation.revoke",
            None,
            now,
        ))
    })
}
pub fn verify(
    repo: &mut impl InvitationRepository,
    id: &str,
    claim: &Secret,
    now: i64,
) -> Result<Invitation> {
    repo.member_invitation(id)?
        .filter(|value| {
            value.revoked_at.is_none()
                && value.consumed_by_member_id.is_none()
                && value.expires_at > now
                && identity::matches(claim.expose(), &value.claim_hash)
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Unauthorized,
                "This invitation is invalid, expired or already used",
            )
        })
}
