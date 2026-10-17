use crate::{
    authorization::active_actor, identity::Actor, permission::Permission,
    port::AuthorizationRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub fn owner_scope(
    repo: &mut impl AuthorizationRepository,
    actor: &Actor,
    any: Permission,
    owned: Permission,
    requested: Option<&str>,
    now: i64,
) -> Result<Option<String>> {
    active_actor(repo, actor, now)?;
    let permissions = repo.permissions(&actor.principal_id)?;
    if permissions.contains(&any) {
        return Ok(requested.map(str::to_owned));
    }
    if !permissions.contains(&owned) || requested.is_some_and(|id| id != actor.principal_id) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "This owner scope is not permitted",
        ));
    }
    Ok(Some(actor.principal_id.clone()))
}
