use super::{rows, store::Store};
use crate::{
    error::failure,
    tables::{
        agent, fleet, fleet_instance, member_session, principal, principal_role, role_permission,
    },
};
use crossfire_domain::permission::Permission;
use crossfire_domain::{
    identity::{Agent, AgentBinding, MemberSession, Principal},
    port::AuthorizationRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use diesel::prelude::*;

impl AuthorizationRepository for Store {
    fn principal(&mut self, id: &str) -> Result<Option<Principal>> {
        principal::table
            .filter(principal::id.eq(id))
            .select(rows::PrincipalRow::as_select())
            .first(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Principal::try_from)
            .transpose()
    }

    fn principal_by_backend_user_id(&mut self, id: &str) -> Result<Option<Principal>> {
        principal::table
            .filter(principal::backend_user_id.eq(id))
            .select(rows::PrincipalRow::as_select())
            .first(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Principal::try_from)
            .transpose()
    }

    fn agent(&mut self, id: &str) -> Result<Option<Agent>> {
        let row: Option<(String, String, String)> = agent::table
            .filter(agent::principal_id.eq(id))
            .select((agent::principal_id, agent::owner_id, agent::wake_mode))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        row.map(|(principal_id, owner_id, mode)| {
            Ok(Agent {
                principal_id,
                owner_id,
                wake_mode: rows::wake(&mode)?,
            })
        })
        .transpose()
    }

    fn agent_binding(&mut self, id: &str) -> Result<Option<AgentBinding>> {
        let row: Option<(String, Option<i64>, Option<i64>)> = fleet_instance::table
            .inner_join(
                fleet::table.on(fleet::owner_id
                    .eq(fleet_instance::owner_id)
                    .and(fleet::fleet_key.eq(fleet_instance::fleet_key))),
            )
            .filter(fleet_instance::agent_id.eq(id))
            .select((
                fleet_instance::agent_id,
                fleet_instance::retired_at,
                fleet::archived_at,
            ))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(
            row.map(|(agent_id, retired_at, fleet_archived_at)| AgentBinding {
                agent_id,
                retired_at,
                fleet_archived_at,
            }),
        )
    }

    fn session(&mut self, hash: &str) -> Result<Option<MemberSession>> {
        let row: Option<(String, String, String, String, i64, i64)> = member_session::table
            .filter(member_session::secret_hash.eq(hash))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(
            |(secret_hash, member_id, csrf, token, created_at, expires_at)| MemberSession {
                secret_hash,
                member_id,
                csrf_secret: Secret::new(csrf),
                native_access_token: Secret::new(token),
                created_at,
                expires_at,
            },
        ))
    }

    fn permissions(&mut self, id: &str) -> Result<Vec<Permission>> {
        let codes: Vec<String> = principal_role::table
            .inner_join(
                role_permission::table.on(role_permission::role_code.eq(principal_role::role_code)),
            )
            .filter(principal_role::principal_id.eq(id))
            .select(role_permission::permission_code)
            .order(role_permission::permission_code.asc())
            .load(self.database.connection())
            .map_err(failure)?;
        codes
            .iter()
            .map(|code| {
                Permission::parse(code).ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Unavailable,
                        "Stored permission is not in the current catalog",
                    )
                })
            })
            .collect()
    }
}
