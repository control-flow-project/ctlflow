use super::{rows, store::Store};
use crate::{
    error::failure,
    tables::{agent, agent_wake_sender, member, principal, principal_application},
};
use crossfire_domain::{
    identity::{Agent, AgentView, Application, Member},
    port::AgentRepository,
    wake::Sender,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable)]
#[diesel(table_name = agent)]
pub(crate) struct AgentRow {
    principal_id: String,
    principal_kind: String,
    owner_id: String,
    wake_mode: String,
}

impl AgentRepository for Store {
    fn agent_name(&mut self, id: &str) -> Result<Option<String>> {
        use crate::tables::agent_name;
        agent_name::table
            .filter(agent_name::agent_id.eq(id))
            .select(agent_name::name)
            .first(self.database.connection())
            .optional()
            .map_err(failure)
    }
    fn insert_agent(&mut self, value: &Agent) -> Result<()> {
        diesel::insert_into(agent::table)
            .values((
                agent::principal_id.eq(&value.principal_id),
                agent::principal_kind.eq("agent"),
                agent::owner_id.eq(&value.owner_id),
                agent::wake_mode.eq(rows::wake_text(value.wake_mode)),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_agent(&mut self, value: &Agent) -> Result<()> {
        let count =
            diesel::update(agent::table.filter(agent::principal_id.eq(&value.principal_id)))
                .set((
                    agent::owner_id.eq(&value.owner_id),
                    agent::wake_mode.eq(rows::wake_text(value.wake_mode)),
                ))
                .execute(self.database.connection())
                .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(ErrorCode::Missing, "Agent not found"))
        }
    }
    fn application(&mut self, id: &str) -> Result<Option<Application>> {
        principal_application::table
            .filter(principal_application::principal_id.eq(id))
            .select(rows::ApplicationRow::as_select())
            .first::<rows::ApplicationRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Application::try_from)
            .transpose()
    }
    fn agent_view(&mut self, id: &str) -> Result<Option<AgentView>> {
        let owner = diesel::alias!(principal as owner);
        let row = principal::table
            .inner_join(agent::table.on(agent::principal_id.eq(principal::id)))
            .inner_join(owner.on(owner.field(principal::id).eq(agent::owner_id)))
            .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
            .inner_join(
                principal_application::table
                    .on(principal_application::principal_id.eq(principal::id)),
            )
            .filter(principal::id.eq(id))
            .select((
                rows::PrincipalRow::as_select(),
                AgentRow::as_select(),
                owner.fields(principal::all_columns),
                rows::MemberRow::as_select(),
                rows::ApplicationRow::as_select(),
            ))
            .first::<(
                rows::PrincipalRow,
                AgentRow,
                rows::PrincipalRow,
                rows::MemberRow,
                rows::ApplicationRow,
            )>(self.database.connection())
            .optional()
            .map_err(failure)?;
        row.map(view).transpose()
    }
    fn wake_senders(&mut self, id: &str) -> Result<Vec<Sender>> {
        let rows: Vec<(String, i64)> = agent_wake_sender::table
            .filter(agent_wake_sender::agent_id.eq(id))
            .select((
                agent_wake_sender::sender_principal_id,
                agent_wake_sender::include_agents,
            ))
            .order(agent_wake_sender::sender_principal_id.asc())
            .load(self.database.connection())
            .map_err(failure)?;
        rows.into_iter()
            .map(|(principal_id, include_agents)| {
                Ok(Sender {
                    principal_id,
                    include_agents: match include_agents {
                        0 => false,
                        1 => true,
                        _ => {
                            return Err(Failure::new(
                                ErrorCode::Unavailable,
                                "Invalid stored wake sender",
                            ));
                        }
                    },
                })
            })
            .collect()
    }
    fn replace_wake_senders(&mut self, id: &str, senders: &[Sender]) -> Result<()> {
        diesel::delete(agent_wake_sender::table.filter(agent_wake_sender::agent_id.eq(id)))
            .execute(self.database.connection())
            .map_err(failure)?;
        let values: Vec<_> = senders
            .iter()
            .map(|sender| {
                (
                    agent_wake_sender::agent_id.eq(id),
                    agent_wake_sender::sender_principal_id.eq(&sender.principal_id),
                    agent_wake_sender::include_agents.eq(i64::from(sender.include_agents)),
                )
            })
            .collect();
        diesel::insert_into(agent_wake_sender::table)
            .values(&values)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
}

pub(crate) fn view(
    (principal, agent, owner, member, application): (
        rows::PrincipalRow,
        AgentRow,
        rows::PrincipalRow,
        rows::MemberRow,
        rows::ApplicationRow,
    ),
) -> Result<AgentView> {
    if rows::kind(&agent.principal_kind)? != crossfire_domain::identity::PrincipalKind::Agent {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Stored agent identity is invalid",
        ));
    }
    Ok(AgentView {
        principal: principal.try_into()?,
        agent: Agent {
            principal_id: agent.principal_id,
            owner_id: agent.owner_id,
            wake_mode: rows::wake(&agent.wake_mode)?,
        },
        owner: owner.try_into()?,
        owner_member: Member {
            principal_id: member.principal_id,
            display_name: member.display_name,
        },
        application: application.try_into()?,
    })
}
