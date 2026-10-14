mod read;
mod rows;
use crate::{
    error::failure,
    store::Store,
    tables::{
        agent_owner_conversation as conversation, agent_room_grant as grant,
        agent_room_permission as permission, fleet_instance_permission as policy_permission,
        fleet_instance_policy as policy, room_grant_application as application,
    },
};
use crossfire_domain::room_access::{port::RoomRepository, values::*};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
use rows::{ApplicationRow, GrantRow, OwnerRow, PermissionRow};
fn affected(count: usize, message: &str) -> Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(Failure::new(ErrorCode::Missing, message))
    }
}
impl RoomRepository for Store {
    fn room_grant(&mut self, agent: &str, room: &str) -> Result<Option<Grant>> {
        grant::table
            .filter(grant::agent_id.eq(agent).and(grant::room_id.eq(room)))
            .select(GrantRow::as_select())
            .first::<GrantRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Grant::try_from)
            .transpose()
    }
    fn room_grants(&mut self, agent: &str) -> Result<Vec<Grant>> {
        grant::table
            .filter(grant::agent_id.eq(agent))
            .order(grant::room_id)
            .select(GrantRow::as_select())
            .load::<GrantRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Grant::try_from)
            .collect()
    }
    fn save_room_grant(&mut self, value: &Grant, insert: bool) -> Result<()> {
        let row = GrantRow::from(value);
        let count = if insert {
            diesel::insert_into(grant::table)
                .values(row)
                .execute(self.database.connection())
        } else {
            diesel::update(
                grant::table.filter(
                    grant::agent_id
                        .eq(&value.agent_id)
                        .and(grant::room_id.eq(&value.room_id)),
                ),
            )
            .set(row)
            .execute(self.database.connection())
        }
        .map_err(failure)?;
        affected(count, "Room grant not found")
    }
    fn room_permission(&mut self, agent: &str, room: &str) -> Result<Option<Permission>> {
        permission::table
            .filter(
                permission::agent_id
                    .eq(agent)
                    .and(permission::room_id.eq(room)),
            )
            .select(PermissionRow::as_select())
            .first::<PermissionRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Permission::try_from)
            .transpose()
    }
    fn replace_room_permissions(
        &mut self,
        agent: &str,
        room: &str,
        value: Option<&Permission>,
    ) -> Result<()> {
        diesel::delete(
            permission::table.filter(
                permission::agent_id
                    .eq(agent)
                    .and(permission::room_id.eq(room)),
            ),
        )
        .execute(self.database.connection())
        .map_err(failure)?;
        if let Some(value) = value {
            diesel::insert_into(permission::table)
                .values(PermissionRow::from(value))
                .execute(self.database.connection())
                .map_err(failure)?;
        }
        Ok(())
    }
    fn room_application(&mut self, agent: &str, room: &str) -> Result<Option<Application>> {
        application::table
            .filter(
                application::agent_id
                    .eq(agent)
                    .and(application::room_id.eq(room)),
            )
            .select(ApplicationRow::as_select())
            .first::<ApplicationRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Application::try_from)
            .transpose()
    }
    fn save_room_application(&mut self, value: &Application, insert: bool) -> Result<()> {
        let row = ApplicationRow::from(value);
        let count = if insert {
            diesel::insert_into(application::table)
                .values(row)
                .execute(self.database.connection())
        } else {
            diesel::update(
                application::table.filter(
                    application::agent_id
                        .eq(&value.agent_id)
                        .and(application::room_id.eq(&value.room_id)),
                ),
            )
            .set(row)
            .execute(self.database.connection())
        }
        .map_err(failure)?;
        affected(count, "Room application not found")
    }
    fn owner_conversation(&mut self, agent: &str) -> Result<Option<OwnerConversation>> {
        Ok(conversation::table
            .filter(conversation::agent_id.eq(agent))
            .select(OwnerRow::as_select())
            .first::<OwnerRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(OwnerConversation::from))
    }
    fn owner_conversation_by_room(&mut self, room: &str) -> Result<Option<OwnerConversation>> {
        Ok(conversation::table
            .filter(conversation::room_id.eq(room))
            .select(OwnerRow::as_select())
            .first::<OwnerRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(OwnerConversation::from))
    }
    fn insert_owner_conversation(&mut self, value: &OwnerConversation) -> Result<()> {
        diesel::insert_into(conversation::table)
            .values(OwnerRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn approved_fleet_policy(&mut self, agent: &str) -> Result<Option<ApprovedPolicy>> {
        let value = policy::table
            .filter(policy::agent_id.eq(agent))
            .select((
                policy::agent_id,
                policy::approved_by_member_id,
                policy::approved_at,
            ))
            .first::<(String, String, i64)>(self.database.connection())
            .optional()
            .map_err(failure)?;
        let Some((agent_id, approved_by_member_id, approved_at)) = value else {
            return Ok(None);
        };
        let permissions: Vec<(String, String)> = policy_permission::table
            .filter(policy_permission::agent_id.eq(agent))
            .select((
                policy_permission::permission_code,
                policy_permission::grant_scope,
            ))
            .load(self.database.connection())
            .map_err(failure)?;
        if permissions.len() > 1
            || permissions
                .iter()
                .any(|(code, scope)| code != "room.agent.invite" || scope != "agent_room")
        {
            return Err(rows::invalid());
        }
        Ok(Some(ApprovedPolicy {
            agent_id,
            approved_by_member_id,
            approved_at,
            invite_agents: !permissions.is_empty(),
        }))
    }
    fn approve_fleet_policy(&mut self, value: &ApprovedPolicy) -> Result<()> {
        diesel::insert_into(policy::table)
            .values((
                policy::agent_id.eq(&value.agent_id),
                policy::approved_by_member_id.eq(&value.approved_by_member_id),
                policy::approved_at.eq(value.approved_at),
            ))
            .on_conflict(policy::agent_id)
            .do_update()
            .set((
                policy::approved_by_member_id.eq(&value.approved_by_member_id),
                policy::approved_at.eq(value.approved_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        diesel::delete(
            policy_permission::table.filter(policy_permission::agent_id.eq(&value.agent_id)),
        )
        .execute(self.database.connection())
        .map_err(failure)?;
        if value.invite_agents {
            diesel::insert_into(policy_permission::table)
                .values((
                    policy_permission::agent_id.eq(&value.agent_id),
                    policy_permission::permission_code.eq("room.agent.invite"),
                    policy_permission::grant_scope.eq("agent_room"),
                ))
                .execute(self.database.connection())
                .map_err(failure)?;
        }
        Ok(())
    }
}
