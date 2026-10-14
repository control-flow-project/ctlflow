use crate::validation as check;
use crossfire_domain::{
    identity::Role, member::invitation::Invitation, member::signup::Fingerprint,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use serde_json::{Value, json};
use zeroize::Zeroize;
pub struct ClaimFingerprint;
impl Fingerprint for ClaimFingerprint {
    fn fingerprint(
        &self,
        claim: &Secret,
        user: &str,
        password: &Secret,
        name: &str,
    ) -> Result<String> {
        let mut value = serde_json::to_string(&(claim.expose(), user, password.expose(), name))
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Human account details cannot be encoded",
                )
            })?;
        let hash = identity::hash(&value);
        value.zeroize();
        Ok(hash)
    }
}
pub fn invitation_creation(value: &Value) -> Result<(Role, i64)> {
    let value = check::object(value, &["roleCode", "expiresSeconds"], &[])?;
    Ok((
        if check::choice(&value["roleCode"], &["member", "administrator"])? == "member" {
            Role::Member
        } else {
            Role::Administrator
        },
        check::integer(&value["expiresSeconds"], 60, 604800)?,
    ))
}
pub fn invitation(value: &Invitation) -> Value {
    json!({"invitationId":value.id,"createdByMemberId":value.created_by_member_id,"roleCode":if value.role==Role::Administrator{"administrator"}else{"member"},"createdAt":value.created_at,"expiresAt":value.expires_at,"consumedByMemberId":value.consumed_by_member_id,"revokedAt":value.revoked_at})
}
