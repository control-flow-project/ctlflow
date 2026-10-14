use crate::{
    agent::{self as mapping, AgentRow},
    error::failure,
    expression::{instr, lower},
    rows,
    store::Store,
    tables::{agent, agent_name, fleet, fleet_instance, member, principal, principal_application},
};
use crossfire_domain::{
    identity::Page,
    read::values::{AgentFilter, AgentRecord},
};
use crossfire_kernel::Result;
use diesel::prelude::*;
pub(super) fn page(
    store: &mut Store,
    input: &AgentFilter<'_>,
    activity: Option<(&[String], bool)>,
) -> Result<Page<AgentRecord>> {
    input.pagination.validate()?;
    let owner = diesel::alias!(principal as owner);
    let search = input.search.to_lowercase();
    let statuses: Vec<_> = input
        .statuses
        .iter()
        .map(|value| rows::status_text(*value))
        .collect();
    let base = principal::table
        .inner_join(agent::table.on(agent::principal_id.eq(principal::id)))
        .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
        .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
        .inner_join(
            principal_application::table.on(principal_application::principal_id.eq(principal::id)),
        )
        .inner_join(agent_name::table.on(agent_name::agent_id.eq(principal::id.nullable())))
        .inner_join(fleet_instance::table.on(fleet_instance::agent_id.eq(principal::id)))
        .inner_join(
            fleet::table.on(fleet::owner_id
                .eq(fleet_instance::owner_id)
                .and(fleet::fleet_key.eq(fleet_instance::fleet_key))),
        );
    let mut count = base
        .filter(
            fleet_instance::retired_at
                .is_null()
                .and(fleet::archived_at.is_null()),
        )
        .filter(principal::status.eq_any(&statuses))
        .filter(
            instr(lower(agent_name::name), &search).gt(0).or(instr(
                lower(principal::matrix_user_id),
                &search,
            )
            .gt(0)),
        )
        .into_boxed();
    let mut records = base
        .filter(
            fleet_instance::retired_at
                .is_null()
                .and(fleet::archived_at.is_null()),
        )
        .filter(principal::status.eq_any(&statuses))
        .filter(
            instr(lower(agent_name::name), &search).gt(0).or(instr(
                lower(principal::matrix_user_id),
                &search,
            )
            .gt(0)),
        )
        .into_boxed();
    if let Some(owner_id) = input.owner_id {
        count = count.filter(agent::owner_id.eq(owner_id));
        records = records.filter(agent::owner_id.eq(owner_id));
    }
    if let Some(ids) = input.agent_ids {
        count = count.filter(principal::id.eq_any(ids));
        records = records.filter(principal::id.eq_any(ids));
    }
    if let Some((ids, include)) = activity {
        if include {
            count = count.filter(principal::id.eq_any(ids));
            records = records.filter(principal::id.eq_any(ids));
        } else {
            count = count.filter(principal::id.ne_all(ids));
            records = records.filter(principal::id.ne_all(ids));
        }
    }
    let total = count
        .count()
        .get_result::<i64>(store.database.connection())
        .map_err(failure)?;
    let values = records
        .order((agent_name::name.asc(), principal::id.asc()))
        .offset(input.pagination.offset())
        .limit(input.pagination.size)
        .select((
            agent_name::name,
            (
                rows::PrincipalRow::as_select(),
                AgentRow::as_select(),
                owner.fields(principal::all_columns),
                rows::MemberRow::as_select(),
                rows::ApplicationRow::as_select(),
            ),
        ))
        .load::<(
            String,
            (
                rows::PrincipalRow,
                AgentRow,
                rows::PrincipalRow,
                rows::MemberRow,
                rows::ApplicationRow,
            ),
        )>(store.database.connection())
        .map_err(failure)?;
    let records = values
        .into_iter()
        .map(|(name, row)| {
            Ok(AgentRecord {
                name,
                view: mapping::view(row)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(input.pagination.finish(records, total))
}
