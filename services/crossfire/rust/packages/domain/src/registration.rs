use crate::{
    identity::{
        Member, Principal, PrincipalKind, PrincipalRole, Role, Status, pending_application,
    },
    policy::InstancePolicy,
    port::CoreRepository,
};
use crossfire_kernel::{Result, identity};

pub fn register(
    repo: &mut impl CoreRepository,
    principal: &Principal,
    role: Role,
    assigned_by: Option<&str>,
    now: i64,
) -> Result<()> {
    repo.insert_principal(principal)?;
    repo.insert_application(&pending_application(principal.id.clone(), now))?;
    repo.insert_role(&PrincipalRole {
        principal_id: principal.id.clone(),
        principal_kind: principal.kind,
        role,
        assigned_by_member_id: assigned_by.map(str::to_owned),
        assigned_at: now,
    })
}

pub fn initialize(repo: &mut impl CoreRepository, administrator: &str, now: i64) -> Result<()> {
    repo.transaction(|repo| {
        if repo.policy()?.is_none() {
            repo.insert_policy(&InstancePolicy::default())?;
        }
        if repo.principal_by_matrix_id(administrator)?.is_some() {
            return Ok(());
        }
        let principal = Principal {
            id: identity::id(),
            matrix_user_id: administrator.to_owned(),
            kind: PrincipalKind::Human,
            status: Status::Active,
            revision: 0,
            created_at: now,
        };
        register(repo, &principal, Role::Administrator, None, now)?;
        let label = administrator
            .strip_prefix('@')
            .and_then(|value| value.split_once(':'))
            .map_or(administrator, |(local, _)| local);
        repo.insert_member(&Member {
            principal_id: principal.id,
            display_name: label.to_owned(),
        })
    })
}
