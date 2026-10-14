use crate::{
    error::failure,
    rows,
    store::Store,
    tables::{audit_event, permission, role},
};
use crossfire_domain::{
    identity::{Page, PrincipalKind},
    read::values::*,
};
use crossfire_kernel::Result;
use diesel::prelude::*;
pub(super) fn roles(store: &mut Store, kind: PrincipalKind) -> Result<Vec<CatalogRole>> {
    role::table
        .filter(role::principal_kind.eq(rows::kind_text(kind)))
        .order(role::code.asc())
        .select((role::code, role::principal_kind, role::label))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|(code, kind, label)| {
            Ok(CatalogRole {
                code,
                principal_kind: rows::kind(&kind)?,
                label,
            })
        })
        .collect()
}
pub(super) fn permissions(store: &mut Store) -> Result<Vec<CatalogPermission>> {
    Ok(permission::table
        .order(permission::code.asc())
        .select((
            permission::code,
            permission::grant_scope,
            permission::description,
        ))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|(code, grant_scope, description)| CatalogPermission {
            code,
            grant_scope,
            description,
        })
        .collect())
}
#[derive(Queryable, Selectable)]
#[diesel(table_name=audit_event)]
struct Row {
    id: String,
    request_id: String,
    actor_credential_id: Option<String>,
    actor_kind: String,
    actor_principal_id: Option<String>,
    owner_id: Option<String>,
    target_kind: String,
    target_id: String,
    room_id: Option<String>,
    membership_generation: Option<String>,
    authorizer_id: Option<String>,
    added_by_id: Option<String>,
    permission_code: Option<String>,
    action: String,
    outcome: String,
    message: String,
    created_at: i64,
}
impl From<Row> for AuditEvent {
    fn from(row: Row) -> Self {
        Self {
            id: row.id,
            request_id: row.request_id,
            actor_credential_id: row.actor_credential_id,
            actor_kind: row.actor_kind,
            actor_principal_id: row.actor_principal_id,
            owner_id: row.owner_id,
            target_kind: row.target_kind,
            target_id: row.target_id,
            room_id: row.room_id,
            membership_generation: row.membership_generation,
            authorizer_id: row.authorizer_id,
            added_by_id: row.added_by_id,
            permission_code: row.permission_code,
            action: row.action,
            outcome: row.outcome,
            message: row.message,
            created_at: row.created_at,
        }
    }
}
pub(super) fn audits(
    store: &mut Store,
    owner: Option<&str>,
    pagination: Pagination,
) -> Result<Page<AuditEvent>> {
    pagination.validate()?;
    let mut count = audit_event::table.into_boxed();
    let mut records = audit_event::table.into_boxed();
    if let Some(id) = owner {
        count = count.filter(audit_event::owner_id.eq(id));
        records = records.filter(audit_event::owner_id.eq(id));
    }
    let total = count
        .count()
        .get_result::<i64>(store.database.connection())
        .map_err(failure)?;
    let items = records
        .order((audit_event::created_at.desc(), audit_event::id.desc()))
        .offset(pagination.offset())
        .limit(pagination.size)
        .select(Row::as_select())
        .load::<Row>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(AuditEvent::from)
        .collect();
    Ok(pagination.finish(items, total))
}
