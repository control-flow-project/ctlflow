use super::{rows, store::Store};
use crate::{
    error::failure,
    tables::{
        agent, audit_event, instance_policy, member, member_session, principal,
        principal_application, principal_role, room_grant_application,
    },
};
use crossfire_domain::{
    identity::{Application, Member, MemberSession, MemberView, Page, Principal, PrincipalRole},
    policy::InstancePolicy,
    port::{Audit, AuditActor, CoreRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = instance_policy)]
struct PolicyRow {
    id: String,
    revision: i64,
    max_owner_agents: i64,
    max_agents: i64,
    max_pending: i64,
    enrollment_seconds: i64,
    reconcile_seconds: i64,
    max_message_bytes: i64,
    fleet_idle_timeout_seconds: i64,
    agent_instructions: String,
    signup_mode: String,
    invitation_issuers: String,
}

fn policy_row(value: &InstancePolicy) -> PolicyRow {
    PolicyRow {
        id: "instance".to_owned(),
        revision: value.revision,
        max_owner_agents: value.max_owner_agents,
        max_agents: value.max_agents,
        max_pending: value.max_pending,
        enrollment_seconds: value.enrollment_seconds,
        reconcile_seconds: value.reconcile_seconds,
        max_message_bytes: value.max_message_bytes,
        fleet_idle_timeout_seconds: value.fleet_idle_timeout_seconds,
        agent_instructions: value.agent_instructions.clone(),
        signup_mode: value.signup_mode.clone(),
        invitation_issuers: value.invitation_issuers.clone(),
    }
}

fn affected(count: usize, name: &str) -> Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Missing,
            format!("{name} not found"),
        ))
    }
}

macro_rules! member_query {
    () => {
        principal::table
            .inner_join(member::table.on(member::principal_id.eq(principal::id)))
            .inner_join(principal_role::table.on(principal_role::principal_id.eq(principal::id)))
            .inner_join(
                principal_application::table
                    .on(principal_application::principal_id.eq(principal::id)),
            )
            .select((
                principal::all_columns,
                member::all_columns,
                principal_role::all_columns,
                principal_application::all_columns,
            ))
    };
}

impl CoreRepository for Store {
    fn insert_principal(&mut self, value: &Principal) -> Result<()> {
        diesel::insert_into(principal::table)
            .values(rows::PrincipalRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_principal(&mut self, value: &Principal) -> Result<()> {
        affected(
            diesel::update(principal::table.filter(principal::id.eq(&value.id)))
                .set(rows::PrincipalRow::from(value))
                .execute(self.database.connection())
                .map_err(failure)?,
            "Principal",
        )
    }
    fn insert_application(&mut self, value: &Application) -> Result<()> {
        diesel::insert_into(principal_application::table)
            .values(rows::ApplicationRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_application(&mut self, value: &Application) -> Result<()> {
        affected(
            diesel::update(
                principal_application::table
                    .filter(principal_application::principal_id.eq(&value.principal_id)),
            )
            .set(rows::ApplicationRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?,
            "Principal application",
        )
    }
    fn insert_role(&mut self, value: &PrincipalRole) -> Result<()> {
        diesel::insert_into(principal_role::table)
            .values(rows::RoleRow {
                principal_id: value.principal_id.clone(),
                principal_kind: rows::kind_text(value.principal_kind).to_owned(),
                role_code: rows::role_text(value.role).to_owned(),
                assigned_by_member_id: value.assigned_by_member_id.clone(),
                assigned_at: value.assigned_at,
            })
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_role(&mut self, value: &PrincipalRole) -> Result<()> {
        affected(
            diesel::update(
                principal_role::table.filter(principal_role::principal_id.eq(&value.principal_id)),
            )
            .set((
                principal_role::role_code.eq(rows::role_text(value.role)),
                principal_role::assigned_by_member_id.eq(&value.assigned_by_member_id),
                principal_role::assigned_at.eq(value.assigned_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?,
            "Principal role",
        )
    }
    fn insert_member(&mut self, value: &Member) -> Result<()> {
        diesel::insert_into(member::table)
            .values(rows::MemberRow {
                principal_id: value.principal_id.clone(),
                principal_kind: "human".to_owned(),
                display_name: value.display_name.clone(),
            })
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_member(&mut self, value: &Member) -> Result<()> {
        affected(
            diesel::update(member::table.filter(member::principal_id.eq(&value.principal_id)))
                .set(member::display_name.eq(&value.display_name))
                .execute(self.database.connection())
                .map_err(failure)?,
            "Member",
        )
    }
    fn member_view(&mut self, id: &str) -> Result<Option<MemberView>> {
        let row = member_query!()
            .filter(principal::id.eq(id))
            .first::<(
                rows::PrincipalRow,
                rows::MemberRow,
                rows::RoleRow,
                rows::ApplicationRow,
            )>(self.database.connection())
            .optional()
            .map_err(failure)?;
        row.map(rows::member_view).transpose()
    }
    fn members_page(&mut self, page: i64, page_size: i64) -> Result<Page<MemberView>> {
        if !(1..=100000).contains(&page) || !(1..=100).contains(&page_size) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use page ≥ 1 and pageSize 1–100",
            ));
        }
        let total_items = member_query!()
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let rows = member_query!()
            .order((principal::created_at.asc(), principal::id.asc()))
            .limit(page_size)
            .offset((page - 1) * page_size)
            .load::<(
                rows::PrincipalRow,
                rows::MemberRow,
                rows::RoleRow,
                rows::ApplicationRow,
            )>(self.database.connection())
            .map_err(failure)?;
        Ok(Page {
            items: rows
                .into_iter()
                .map(rows::member_view)
                .collect::<Result<Vec<_>>>()?,
            page,
            page_size,
            total_items,
            total_pages: ((total_items + page_size - 1) / page_size).max(1),
        })
    }
    fn active_administrator_count(&mut self) -> Result<i64> {
        principal::table
            .inner_join(principal_role::table.on(principal_role::principal_id.eq(principal::id)))
            .filter(
                principal::status
                    .eq("active")
                    .and(principal_role::role_code.eq("administrator")),
            )
            .count()
            .get_result(self.database.connection())
            .map_err(failure)
    }
    fn schedule_owned_agents(&mut self, owner_id: &str, revoke: bool, now: i64) -> Result<()> {
        let ids = agent::table
            .filter(agent::owner_id.eq(owner_id))
            .select(agent::principal_id)
            .load::<String>(self.database.connection())
            .map_err(failure)?;
        if revoke {
            diesel::update(
                principal::table.filter(
                    principal::id
                        .eq_any(&ids)
                        .and(principal::status.ne("revoked")),
                ),
            )
            .set((
                principal::status.eq("revoked"),
                principal::revision.eq(principal::revision + 1),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        }
        let changed = diesel::update(
            principal_application::table.filter(principal_application::principal_id.eq_any(&ids)),
        )
        .set(principal_application::next_check_at.eq(now))
        .execute(self.database.connection())
        .map_err(failure)?;
        if changed != ids.len() {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Owned agent state is missing",
            ));
        }
        diesel::update(
            room_grant_application::table.filter(room_grant_application::agent_id.eq_any(&ids)),
        )
        .set(room_grant_application::next_check_at.eq(now))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
    fn policy(&mut self) -> Result<Option<InstancePolicy>> {
        let row = instance_policy::table
            .filter(instance_policy::id.eq("instance"))
            .select(PolicyRow::as_select())
            .first::<PolicyRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(|row| InstancePolicy {
            revision: row.revision,
            max_owner_agents: row.max_owner_agents,
            max_agents: row.max_agents,
            max_pending: row.max_pending,
            enrollment_seconds: row.enrollment_seconds,
            reconcile_seconds: row.reconcile_seconds,
            max_message_bytes: row.max_message_bytes,
            fleet_idle_timeout_seconds: row.fleet_idle_timeout_seconds,
            agent_instructions: row.agent_instructions,
            signup_mode: row.signup_mode,
            invitation_issuers: row.invitation_issuers,
        }))
    }
    fn insert_policy(&mut self, value: &InstancePolicy) -> Result<()> {
        diesel::insert_into(instance_policy::table)
            .values(policy_row(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_policy(&mut self, value: &InstancePolicy) -> Result<()> {
        affected(
            diesel::update(instance_policy::table.filter(instance_policy::id.eq("instance")))
                .set(policy_row(value))
                .execute(self.database.connection())
                .map_err(failure)?,
            "Instance policy",
        )
    }
    fn audit(&mut self, value: &Audit) -> Result<()> {
        let (kind, principal_id, credential_id) = match &value.actor {
            AuditActor::Principal(actor) => (
                rows::kind_text(actor.kind),
                Some(actor.principal_id.as_str()),
                None,
            ),
            AuditActor::Controller { credential_id } => {
                ("controller", None, Some(credential_id.as_str()))
            }
            AuditActor::System => ("system", None, None),
            AuditActor::Anonymous => ("anonymous", None, None),
        };
        diesel::insert_into(audit_event::table)
            .values((
                audit_event::id.eq(identity::id()),
                audit_event::request_id.eq(&value.request_id),
                audit_event::actor_kind.eq(kind),
                audit_event::actor_principal_id.eq(principal_id),
                audit_event::actor_credential_id.eq(credential_id),
                audit_event::owner_id.eq(&value.owner_id),
                audit_event::room_id.eq(&value.room_id),
                audit_event::membership_generation.eq(&value.membership_generation),
                audit_event::authorizer_id.eq(&value.authorizer_id),
                audit_event::added_by_id.eq(&value.added_by_id),
                audit_event::permission_code.eq(&value.permission_code),
                audit_event::target_kind.eq(&value.target_kind),
                audit_event::target_id.eq(&value.target_id),
                audit_event::action.eq(&value.action),
                audit_event::outcome.eq("accepted"),
                audit_event::message.eq(&value.message),
                audit_event::created_at.eq(value.created_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn remove_expired_sessions(&mut self, now: i64) -> Result<()> {
        diesel::delete(member_session::table.filter(member_session::expires_at.le(now)))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn session_count(&mut self, id: &str, now: i64) -> Result<i64> {
        member_session::table
            .filter(
                member_session::member_id
                    .eq(id)
                    .and(member_session::expires_at.gt(now)),
            )
            .count()
            .get_result(self.database.connection())
            .map_err(failure)
    }
    fn insert_session(&mut self, value: &MemberSession) -> Result<()> {
        diesel::insert_into(member_session::table)
            .values((
                member_session::secret_hash.eq(&value.secret_hash),
                member_session::member_id.eq(&value.member_id),
                member_session::csrf_secret.eq(value.csrf_secret.expose()),
                member_session::native_access_token.eq(value.native_access_token.expose()),
                member_session::created_at.eq(value.created_at),
                member_session::expires_at.eq(value.expires_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn remove_session(&mut self, hash: &str) -> Result<()> {
        diesel::delete(member_session::table.filter(member_session::secret_hash.eq(hash)))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
}
