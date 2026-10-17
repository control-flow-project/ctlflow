use super::{access::owner_scope, port::ReadRepository, values::*};
use crate::{
    authorization::authorize,
    identity::{Actor, Page},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};
pub fn principals(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    filter: &DiscoveryFilter<'_>,
    now: i64,
) -> Result<Page<crate::identity::PrincipalSummary>> {
    authorize(repo, actor, Permission::PrincipalRead, now)?;
    filter.pagination.validate()?;
    repo.discover(filter)
}
pub fn resolve(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    ids: &[String],
    now: i64,
) -> Result<Vec<PrincipalIdentity>> {
    authorize(repo, actor, Permission::PrincipalRead, now)?;
    if ids.is_empty() || ids.len() > 100 || ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Resolve 1–100 unique Matrix identities",
        ));
    }
    let mut identities: BTreeMap<_, _> = repo
        .identities(ids)?
        .into_iter()
        .map(|value| (value.matrix_user_id.clone(), value))
        .collect();
    Ok(ids
        .iter()
        .map(|id| {
            identities.remove(id).unwrap_or_else(|| PrincipalIdentity {
                matrix_user_id: id.clone(),
                kind: None,
                owner_matrix_id: None,
                display_name: None,
                owner_display_name: None,
            })
        })
        .collect())
}
pub fn roles(repo: &mut impl ReadRepository, actor: &Actor, now: i64) -> Result<Vec<CatalogRole>> {
    authorize(repo, actor, Permission::PrincipalRead, now)?;
    repo.catalog_roles(actor.kind)
}
pub fn permissions(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    now: i64,
) -> Result<Vec<CatalogPermission>> {
    authorize(repo, actor, Permission::PrincipalRead, now)?;
    repo.catalog_permissions()
}
pub fn audits(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    owner: Option<&str>,
    pagination: Pagination,
    now: i64,
) -> Result<Page<AuditDetails>> {
    let owner = owner_scope(
        repo,
        actor,
        Permission::AuditReadAny,
        Permission::AuditReadOwned,
        owner,
        now,
    )?;
    pagination.validate()?;
    let page = repo.audits_page(owner.as_deref(), pagination)?;
    let ids: BTreeSet<_> = page
        .items
        .iter()
        .flat_map(|event| {
            event.actor_principal_id.iter().cloned().chain(
                ["agent", "member"]
                    .contains(&event.target_kind.as_str())
                    .then(|| event.target_id.clone()),
            )
        })
        .collect();
    let identities: BTreeMap<_, _> = repo
        .selected_principals(&ids.into_iter().collect::<Vec<_>>())?
        .into_iter()
        .map(|value| (value.principal_id.clone(), value))
        .collect();
    Ok(Page {
        items: page
            .items
            .into_iter()
            .map(|event| {
                let actor = event
                    .actor_principal_id
                    .as_ref()
                    .and_then(|id| identities.get(id))
                    .cloned();
                let target = if ["agent", "member"].contains(&event.target_kind.as_str()) {
                    identities.get(&event.target_id).cloned()
                } else {
                    None
                };
                AuditDetails {
                    event,
                    actor,
                    target,
                }
            })
            .collect(),
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
