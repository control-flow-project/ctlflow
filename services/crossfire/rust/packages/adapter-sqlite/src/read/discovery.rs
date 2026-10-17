use crate::{
    discovery::SummaryRow,
    error::failure,
    store::Store,
    tables::{agent, agent_name, fleet, fleet_instance, member, principal},
};
use crossfire_domain::{
    identity::{Page, PrincipalKind, PrincipalSummary, agent_display_name},
    read::values::{DiscoveryFilter, PrincipalIdentity},
};
use crossfire_kernel::Result;
use diesel::prelude::*;
pub(super) fn page(
    store: &mut Store,
    filter: &DiscoveryFilter<'_>,
) -> Result<Page<PrincipalSummary>> {
    filter.pagination.validate()?;
    let search = format!("%{}%", filter.search);
    let excluded = filter.exclude_id.unwrap_or("");
    let humans = principal::table
        .inner_join(member::table.on(member::principal_id.eq(principal::id)))
        .filter(
            principal::status
                .eq("active")
                .and(principal::id.ne(excluded)),
        )
        .filter(
            principal::matrix_user_id
                .like(&search)
                .or(member::display_name.like(&search)),
        );
    let owner = diesel::alias!(principal as owner);
    let agents = principal::table
        .inner_join(agent::table.on(agent::principal_id.eq(principal::id)))
        .inner_join(agent_name::table.on(agent_name::agent_id.eq(principal::id.nullable())))
        .inner_join(fleet_instance::table.on(fleet_instance::agent_id.eq(principal::id)))
        .inner_join(
            fleet::table.on(fleet::owner_id
                .eq(fleet_instance::owner_id)
                .and(fleet::fleet_key.eq(fleet_instance::fleet_key))),
        )
        .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
        .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
        .filter(
            principal::status
                .eq("active")
                .and(owner.field(principal::status).eq("active"))
                .and(principal::id.ne(excluded))
                .and(fleet_instance::retired_at.is_null())
                .and(fleet::archived_at.is_null()),
        )
        .filter(
            principal::matrix_user_id
                .like(&search)
                .or(agent_name::name.like(&search)),
        );
    let humans_count = if filter.kind == Some(PrincipalKind::Agent) {
        0
    } else {
        humans
            .count()
            .get_result::<i64>(store.database.connection())
            .map_err(failure)?
    };
    let agents_count = if filter.kind == Some(PrincipalKind::Human) {
        0
    } else {
        agents
            .count()
            .get_result::<i64>(store.database.connection())
            .map_err(failure)?
    };
    let offset = filter.pagination.offset();
    let human_limit = filter.pagination.size.min((humans_count - offset).max(0));
    let mut items = if human_limit == 0 {
        Vec::new()
    } else {
        humans
            .order((member::display_name.asc(), principal::id.asc()))
            .offset(offset)
            .limit(human_limit)
            .select((
                principal::id,
                principal::matrix_user_id,
                principal::kind,
                member::display_name,
                principal::id,
                principal::matrix_user_id,
            ))
            .load::<SummaryRow>(store.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(|row| {
                let name = row.name.clone();
                row.value(name)
            })
            .collect::<Result<Vec<_>>>()?
    };
    if filter.kind != Some(PrincipalKind::Human) && items.len() < (filter.pagination.size as usize)
    {
        let records = agents
            .order((agent_name::name.asc(), principal::id.asc()))
            .offset((offset - humans_count).max(0))
            .limit(filter.pagination.size - items.len() as i64)
            .select((
                (
                    principal::id,
                    principal::matrix_user_id,
                    principal::kind,
                    agent_name::name,
                    agent::owner_id,
                    owner.field(principal::matrix_user_id),
                ),
                member::display_name,
            ))
            .load::<(SummaryRow, String)>(store.database.connection())
            .map_err(failure)?;
        for (row, owner_name) in records {
            let name = agent_display_name(&row.name, &owner_name);
            items.push(row.value(name)?);
        }
    }
    Ok(filter.pagination.finish(items, humans_count + agents_count))
}
pub(super) fn identities(store: &mut Store, ids: &[String]) -> Result<Vec<PrincipalIdentity>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut result = principal::table
        .inner_join(member::table.on(member::principal_id.eq(principal::id)))
        .filter(
            principal::kind
                .eq("human")
                .and(principal::matrix_user_id.eq_any(ids)),
        )
        .select((principal::matrix_user_id, member::display_name))
        .load::<(String, String)>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|(matrix_user_id, name)| PrincipalIdentity {
            matrix_user_id,
            kind: Some(PrincipalKind::Human),
            display_name: Some(name),
            owner_matrix_id: None,
            owner_display_name: None,
        })
        .collect::<Vec<_>>();
    let owner = diesel::alias!(principal as owner);
    let agents = agent::table
        .inner_join(principal::table.on(principal::id.eq(agent::principal_id)))
        .inner_join(agent_name::table.on(agent_name::agent_id.eq(agent::principal_id.nullable())))
        .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
        .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
        .filter(principal::matrix_user_id.eq_any(ids))
        .select((
            principal::matrix_user_id,
            agent_name::name,
            owner.field(principal::matrix_user_id),
            member::display_name,
        ))
        .load::<(String, String, String, String)>(store.database.connection())
        .map_err(failure)?;
    result.extend(
        agents.into_iter().map(
            |(matrix_user_id, name, owner_id, owner_name)| PrincipalIdentity {
                matrix_user_id,
                kind: Some(PrincipalKind::Agent),
                display_name: Some(agent_display_name(&name, &owner_name)),
                owner_matrix_id: Some(owner_id),
                owner_display_name: Some(owner_name),
            },
        ),
    );
    Ok(result)
}
