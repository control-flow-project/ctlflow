use crate::{
    error::failure,
    rows,
    store::Store,
    tables::{
        agent, agent_name, fleet, fleet_instance, member, principal, principal_application,
        principal_role,
    },
};
use crossfire_domain::{
    identity::{ActiveIdentity, Principal, PrincipalSummary, agent_display_name},
    port::DiscoveryRepository,
};
use crossfire_kernel::Result;
use diesel::prelude::*;

#[derive(Queryable)]
pub(crate) struct SummaryRow {
    principal_id: String,
    backend_user_id: String,
    kind: String,
    pub(crate) name: String,
    owner_id: String,
    owner_backend_user_id: String,
}

impl SummaryRow {
    pub(crate) fn value(self, display_name: String) -> Result<PrincipalSummary> {
        Ok(PrincipalSummary {
            principal_id: self.principal_id,
            backend_user_id: self.backend_user_id,
            kind: rows::kind(&self.kind)?,
            display_name,
            owner_id: self.owner_id,
            owner_backend_user_id: self.owner_backend_user_id,
        })
    }
}

impl DiscoveryRepository for Store {
    fn active_principals(&mut self) -> Result<Vec<ActiveIdentity>> {
        let humans = principal::table
            .inner_join(member::table.on(member::principal_id.eq(principal::id)))
            .inner_join(principal_role::table.on(principal_role::principal_id.eq(principal::id)))
            .inner_join(
                principal_application::table
                    .on(principal_application::principal_id.eq(principal::id)),
            )
            .filter(principal::status.eq("active"))
            .select(rows::PrincipalRow::as_select())
            .load::<rows::PrincipalRow>(self.database.connection())
            .map_err(failure)?;
        let mut result = humans
            .into_iter()
            .map(|row| {
                Ok(ActiveIdentity {
                    principal: Principal::try_from(row)?,
                    owner_id: None,
                })
            })
            .collect::<Result<Vec<_>>>()?;
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
            .inner_join(
                principal_application::table
                    .on(principal_application::principal_id.eq(principal::id)),
            )
            .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
            .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
            .filter(
                principal::status
                    .eq("active")
                    .and(owner.field(principal::status).eq("active"))
                    .and(fleet_instance::retired_at.is_null())
                    .and(fleet::archived_at.is_null())
                    .and(agent::owner_id.eq(fleet::owner_id)),
            )
            .select((rows::PrincipalRow::as_select(), agent::owner_id))
            .load::<(rows::PrincipalRow, String)>(self.database.connection())
            .map_err(failure)?;
        for (row, owner) in agents {
            result.push(ActiveIdentity {
                principal: Principal::try_from(row)?,
                owner_id: Some(owner),
            });
        }
        Ok(result)
    }
    fn selected_principals(&mut self, ids: &[String]) -> Result<Vec<PrincipalSummary>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let humans = member::table
            .inner_join(principal::table.on(member::principal_id.eq(principal::id)))
            .filter(principal::id.eq_any(ids))
            .select((
                principal::id,
                principal::backend_user_id,
                principal::kind,
                member::display_name,
                principal::id,
                principal::backend_user_id,
            ))
            .load::<SummaryRow>(self.database.connection())
            .map_err(failure)?;
        let mut result = humans
            .into_iter()
            .map(|value| {
                let name = value.name.clone();
                value.value(name)
            })
            .collect::<Result<Vec<_>>>()?;
        let owner = diesel::alias!(principal as owner);
        let agents = agent::table
            .inner_join(principal::table.on(agent::principal_id.eq(principal::id)))
            .inner_join(
                agent_name::table.on(agent_name::agent_id.eq(agent::principal_id.nullable())),
            )
            .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
            .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
            .filter(principal::id.eq_any(ids))
            .select((
                (
                    principal::id,
                    principal::backend_user_id,
                    principal::kind,
                    agent_name::name,
                    agent::owner_id,
                    owner.field(principal::backend_user_id),
                ),
                member::display_name,
            ))
            .load::<(SummaryRow, String)>(self.database.connection())
            .map_err(failure)?;
        for (value, owner_name) in agents {
            let name = agent_display_name(&value.name, &owner_name);
            result.push(value.value(name)?);
        }
        result.sort_by(|first, second| first.principal_id.cmp(&second.principal_id));
        Ok(result)
    }
}
