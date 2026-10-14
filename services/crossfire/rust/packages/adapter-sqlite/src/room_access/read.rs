use super::rows::{ApplicationRow, GrantRow, PermissionRow};
use crate::{
    error::failure,
    store::Store,
    tables::{
        agent_room_grant as grant, agent_room_permission as permission,
        room_grant_application as application,
    },
};
use crossfire_domain::{
    identity::Page,
    read::values::Pagination,
    room_access::{port::RoomReadRepository, values::*},
};
use crossfire_kernel::Result;
use diesel::prelude::*;
impl RoomReadRepository for Store {
    fn grants_page(
        &mut self,
        agent: &str,
        pagination: Pagination,
        rooms: Option<&[String]>,
    ) -> Result<Page<Grant>> {
        pagination.validate()?;
        let mut count = grant::table.filter(grant::agent_id.eq(agent)).into_boxed();
        let mut records = grant::table.filter(grant::agent_id.eq(agent)).into_boxed();
        if let Some(rooms) = rooms {
            count = count.filter(grant::room_id.eq_any(rooms));
            records = records.filter(grant::room_id.eq_any(rooms));
        }
        let total = count
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let items = records
            .order(grant::room_id.asc())
            .offset(pagination.offset())
            .limit(pagination.size)
            .select(GrantRow::as_select())
            .load::<GrantRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Grant::try_from)
            .collect::<Result<Vec<_>>>()?;
        Ok(pagination.finish(items, total))
    }
    fn applications_for_rooms(
        &mut self,
        agent: &str,
        rooms: &[String],
    ) -> Result<Vec<Application>> {
        application::table
            .filter(
                application::agent_id
                    .eq(agent)
                    .and(application::room_id.eq_any(rooms)),
            )
            .select(ApplicationRow::as_select())
            .load::<ApplicationRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Application::try_from)
            .collect()
    }
    fn permissions_for_rooms(&mut self, agent: &str, rooms: &[String]) -> Result<Vec<Permission>> {
        permission::table
            .filter(
                permission::agent_id
                    .eq(agent)
                    .and(permission::room_id.eq_any(rooms)),
            )
            .select(PermissionRow::as_select())
            .load::<PermissionRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Permission::try_from)
            .collect()
    }
    fn relations_for_agents(
        &mut self,
        agents: &[String],
    ) -> Result<(Vec<Grant>, Vec<Application>)> {
        let grants = grant::table
            .filter(grant::agent_id.eq_any(agents))
            .order((grant::agent_id.asc(), grant::room_id.asc()))
            .select(GrantRow::as_select())
            .load::<GrantRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Grant::try_from)
            .collect::<Result<Vec<_>>>()?;
        let applications = application::table
            .filter(application::agent_id.eq_any(agents))
            .order((application::agent_id.asc(), application::room_id.asc()))
            .select(ApplicationRow::as_select())
            .load::<ApplicationRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Application::try_from)
            .collect::<Result<Vec<_>>>()?;
        Ok((grants, applications))
    }
    fn due_room_grants(&mut self, now: i64) -> Result<Vec<(String, String)>> {
        application::table
            .filter(application::next_check_at.le(now))
            .order((
                application::next_check_at.asc(),
                application::agent_id.asc(),
                application::room_id.asc(),
            ))
            .select((application::agent_id, application::room_id))
            .load(self.database.connection())
            .map_err(failure)
    }
}
