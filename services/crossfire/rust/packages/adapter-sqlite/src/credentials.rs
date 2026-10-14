use crate::{error::failure, store::Store, tables::agent_credential};
use crossfire_domain::{identity::AgentCredential, port::CredentialRepository};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use diesel::prelude::*;
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name=agent_credential,treat_none_as_null=true)]
struct Row {
    agent_id: String,
    provisioning_password: String,
    access_token: Option<String>,
    updated_at: i64,
}
impl From<&AgentCredential> for Row {
    fn from(value: &AgentCredential) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            provisioning_password: value.provisioning_password.expose().to_owned(),
            access_token: value
                .access_token
                .as_ref()
                .map(|token| token.expose().to_owned()),
            updated_at: value.updated_at,
        }
    }
}
impl CredentialRepository for Store {
    fn agent_credential(&mut self, id: &str) -> Result<Option<AgentCredential>> {
        let row = agent_credential::table
            .filter(agent_credential::agent_id.eq(id))
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(|row| AgentCredential {
            agent_id: row.agent_id,
            provisioning_password: Secret::new(row.provisioning_password),
            access_token: row.access_token.map(Secret::new),
            updated_at: row.updated_at,
        }))
    }
    fn insert_agent_credential(&mut self, value: &AgentCredential) -> Result<()> {
        diesel::insert_into(agent_credential::table)
            .values(Row::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_agent_credential(&mut self, value: &AgentCredential) -> Result<()> {
        let count = diesel::update(
            agent_credential::table.filter(agent_credential::agent_id.eq(&value.agent_id)),
        )
        .set(Row::from(value))
        .execute(self.database.connection())
        .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Missing,
                "Agent credential is missing",
            ))
        }
    }
}
