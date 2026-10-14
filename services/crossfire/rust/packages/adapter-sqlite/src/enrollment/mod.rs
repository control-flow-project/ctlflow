use crate::{
    error::failure,
    store::Store,
    tables::{
        agent, agent_name, enrollment_item, enrollment_request, fleet, fleet_instance, principal,
    },
};
use crossfire_domain::enrollment::{port::EnrollmentRepository, values::Name};
use crossfire_kernel::Result;
use diesel::prelude::*;
mod policy;
mod records;
mod rows;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = agent_name, treat_none_as_null = true)]
struct NameRow {
    name: String,
    request_id: Option<String>,
    instance_key: Option<String>,
    agent_id: Option<String>,
}
impl EnrollmentRepository for Store {
    fn enrollment_request(
        &mut self,
        id: &str,
    ) -> Result<Option<crossfire_domain::enrollment::values::Request>> {
        records::request(self, id)
    }
    fn save_enrollment_request(
        &mut self,
        value: &crossfire_domain::enrollment::values::Request,
        insert: bool,
    ) -> Result<()> {
        records::save_request(self, value, insert)
    }
    fn expired_enrollments(
        &mut self,
        now: i64,
    ) -> Result<Vec<crossfire_domain::enrollment::values::Request>> {
        records::expired(self, now)
    }
    fn pending_enrollment_count(&mut self) -> Result<i64> {
        records::pending(self)
    }
    fn enrollments_page(
        &mut self,
        owner: Option<&str>,
        page: i64,
        size: i64,
    ) -> Result<crossfire_domain::identity::Page<crossfire_domain::enrollment::values::Request>>
    {
        records::page(self, owner, page, size)
    }
    fn enrollment_items(
        &mut self,
        id: &str,
    ) -> Result<Vec<crossfire_domain::enrollment::values::Item>> {
        records::items(self, id)
    }
    fn save_enrollment_item(
        &mut self,
        value: &crossfire_domain::enrollment::values::Item,
        insert: bool,
    ) -> Result<()> {
        records::save_item(self, value, insert)
    }
    fn insert_requested_policy(
        &mut self,
        item: &crossfire_domain::enrollment::values::Item,
        value: &crossfire_domain::coordination::RequestedPolicy,
    ) -> Result<()> {
        policy::insert(self, item, value)
    }
    fn requested_policies(
        &mut self,
        id: &str,
    ) -> Result<std::collections::BTreeMap<String, crossfire_domain::coordination::RequestedPolicy>>
    {
        policy::read(self, id)
    }
    fn insert_enrollment_metadata(&mut self, id: &str, key: &str, value: &str) -> Result<()> {
        records::insert_metadata(self, id, key, value)
    }
    fn enrollment_metadata(
        &mut self,
        id: &str,
    ) -> Result<std::collections::BTreeMap<String, String>> {
        records::metadata(self, id)
    }
    fn save_fleet_metadata(&mut self, id: &str, key: &str, value: &str) -> Result<()> {
        records::fleet_metadata(self, id, key, value)
    }
    fn save_name_claim(&mut self, value: &Name, insert: bool) -> Result<()> {
        let row = NameRow {
            name: value.name.clone(),
            request_id: value.request_id.clone(),
            instance_key: value.instance_key.clone(),
            agent_id: value.agent_id.clone(),
        };
        if insert {
            diesel::insert_into(agent_name::table)
                .values(&row)
                .execute(self.database.connection())
                .map_err(failure)?;
        } else {
            records::affected(
                diesel::update(agent_name::table.filter(agent_name::name.eq(&value.name)))
                    .set(&row)
                    .execute(self.database.connection())
                    .map_err(failure)?,
            )?;
        }
        Ok(())
    }
    fn remove_name(&mut self, name: &str) -> Result<()> {
        records::affected(
            diesel::delete(agent_name::table.filter(agent_name::name.eq(name)))
                .execute(self.database.connection())
                .map_err(failure)?,
        )
    }
    fn remove_request_names(&mut self, id: &str) -> Result<()> {
        diesel::delete(agent_name::table.filter(agent_name::request_id.eq(id)))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn name_claim(&mut self, name: &str) -> Result<Option<Name>> {
        let value = agent_name::table
            .filter(agent_name::name.eq(name))
            .select(NameRow::as_select())
            .first::<NameRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(value.map(|value| Name {
            name: value.name,
            request_id: value.request_id,
            instance_key: value.instance_key,
            agent_id: value.agent_id,
        }))
    }
    fn enrolled_agent_count(&mut self, owner: Option<&str>) -> Result<i64> {
        let mut query = agent::table
            .inner_join(principal::table.on(principal::id.eq(agent::principal_id)))
            .inner_join(fleet_instance::table.on(fleet_instance::agent_id.eq(agent::principal_id)))
            .inner_join(
                fleet::table.on(fleet::owner_id
                    .eq(fleet_instance::owner_id)
                    .and(fleet::fleet_key.eq(fleet_instance::fleet_key))),
            )
            .filter(
                principal::status
                    .ne("revoked")
                    .and(fleet_instance::retired_at.is_null())
                    .and(fleet::archived_at.is_null())
                    .and(agent::owner_id.eq(fleet::owner_id)),
            )
            .into_boxed();
        if let Some(owner) = owner {
            query = query.filter(agent::owner_id.eq(owner));
        }
        query
            .count()
            .get_result(self.database.connection())
            .map_err(failure)
    }
    fn pending_identity_count(&mut self, owner: Option<&str>) -> Result<i64> {
        let mut query = enrollment_request::table
            .inner_join(
                enrollment_item::table.on(enrollment_item::request_id.eq(enrollment_request::id)),
            )
            .filter(
                enrollment_request::status
                    .eq("pending")
                    .and(enrollment_item::outcome.eq("claimed"))
                    .and(enrollment_item::agent_id.is_null()),
            )
            .into_boxed();
        if let Some(owner) = owner {
            query = query.filter(enrollment_request::owner_id.eq(owner));
        }
        query
            .count()
            .get_result(self.database.connection())
            .map_err(failure)
    }
}
