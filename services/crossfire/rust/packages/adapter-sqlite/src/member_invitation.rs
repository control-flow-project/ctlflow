use crate::{error::failure, rows, store::Store, tables::member_invitation as invitation};
use crossfire_domain::{
    identity::{Page, Role},
    member::invitation::{Invitation, InvitationRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name=invitation,treat_none_as_null=true)]
struct Row {
    id: String,
    created_by_member_id: String,
    claim_hash: String,
    role_code: String,
    principal_kind: String,
    created_at: i64,
    expires_at: i64,
    consumed_by_member_id: Option<String>,
    revoked_at: Option<i64>,
    claim_backend_user_id: Option<String>,
    claim_display_name: Option<String>,
    claim_fingerprint: Option<String>,
}
impl From<&Invitation> for Row {
    fn from(value: &Invitation) -> Self {
        Self {
            id: value.id.clone(),
            created_by_member_id: value.created_by_member_id.clone(),
            claim_hash: value.claim_hash.clone(),
            role_code: rows::role_text(value.role).to_owned(),
            principal_kind: "human".to_owned(),
            created_at: value.created_at,
            expires_at: value.expires_at,
            consumed_by_member_id: value.consumed_by_member_id.clone(),
            revoked_at: value.revoked_at,
            claim_backend_user_id: value.claim_backend_user_id.clone(),
            claim_display_name: value.claim_display_name.clone(),
            claim_fingerprint: value.claim_fingerprint.clone(),
        }
    }
}
impl TryFrom<Row> for Invitation {
    type Error = Failure;
    fn try_from(value: Row) -> Result<Self> {
        let role = rows::role(&value.role_code)?;
        if role == Role::Agent || value.principal_kind != "human" {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Invalid stored human invitation role",
            ));
        }
        Ok(Self {
            id: value.id,
            created_by_member_id: value.created_by_member_id,
            claim_hash: value.claim_hash,
            role,
            created_at: value.created_at,
            expires_at: value.expires_at,
            consumed_by_member_id: value.consumed_by_member_id,
            revoked_at: value.revoked_at,
            claim_backend_user_id: value.claim_backend_user_id,
            claim_display_name: value.claim_display_name,
            claim_fingerprint: value.claim_fingerprint,
        })
    }
}
impl InvitationRepository for Store {
    fn member_invitation(&mut self, id: &str) -> Result<Option<Invitation>> {
        invitation::table
            .filter(invitation::id.eq(id))
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Invitation::try_from)
            .transpose()
    }
    fn save_member_invitation(&mut self, value: &Invitation, insert: bool) -> Result<()> {
        let row = Row::from(value);
        let count = if insert {
            diesel::insert_into(invitation::table)
                .values(row)
                .execute(self.database.connection())
        } else {
            diesel::update(invitation::table.filter(invitation::id.eq(&value.id)))
                .set(row)
                .execute(self.database.connection())
        }
        .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(ErrorCode::Missing, "Invitation not found"))
        }
    }
    fn member_invitations_page(
        &mut self,
        creator: Option<&str>,
        page: i64,
        size: i64,
    ) -> Result<Page<Invitation>> {
        if !(1..=100000).contains(&page) || !(1..=100).contains(&size) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use page ≥ 1 and pageSize 1–100",
            ));
        }
        let mut count = invitation::table.into_boxed();
        let mut items = invitation::table.into_boxed();
        if let Some(id) = creator {
            count = count.filter(invitation::created_by_member_id.eq(id));
            items = items.filter(invitation::created_by_member_id.eq(id));
        }
        let total = count
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let items = items
            .order((invitation::created_at.desc(), invitation::id.asc()))
            .limit(size)
            .offset((page - 1) * size)
            .select(Row::as_select())
            .load::<Row>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Invitation::try_from)
            .collect::<Result<Vec<_>>>()?;
        Ok(Page {
            items,
            page,
            page_size: size,
            total_items: total,
            total_pages: ((total + size - 1) / size).max(1),
        })
    }
    fn invitation_by_claim(&mut self, user: &str) -> Result<Option<Invitation>> {
        invitation::table
            .filter(invitation::claim_backend_user_id.eq(user))
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Invitation::try_from)
            .transpose()
    }
    fn abandoned_invitation_claims(&mut self, now: i64) -> Result<Vec<Invitation>> {
        invitation::table
            .filter(
                invitation::claim_backend_user_id
                    .is_not_null()
                    .and(invitation::consumed_by_member_id.is_null())
                    .and(
                        invitation::revoked_at
                            .is_not_null()
                            .or(invitation::expires_at.le(now)),
                    ),
            )
            .select(Row::as_select())
            .load::<Row>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Invitation::try_from)
            .collect()
    }
}
