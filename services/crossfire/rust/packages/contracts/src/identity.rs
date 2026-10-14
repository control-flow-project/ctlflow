use crossfire_domain::identity::PrincipalSummary;
use serde::{Serialize, Serializer, ser::SerializeStruct};
pub struct IntentHash;
impl crossfire_domain::principal::IntentHash for IntentHash {
    fn hash(
        &self,
        matrix_id: &str,
        status: crossfire_domain::identity::Status,
        display_name: &str,
    ) -> crossfire_kernel::Result<String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Intent<'a> {
            matrix_user_id: &'a str,
            status: &'static str,
            display_name: &'a str,
        }
        let status = match status {
            crossfire_domain::identity::Status::Active => "active",
            crossfire_domain::identity::Status::Suspended => "suspended",
            crossfire_domain::identity::Status::Revoked => "revoked",
        };
        let value = serde_json::to_string(&Intent {
            matrix_user_id: matrix_id,
            status,
            display_name,
        })
        .map_err(|_| {
            crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Invalid,
                "Principal native intent cannot be encoded",
            )
        })?;
        Ok(crossfire_kernel::identity::hash(&value))
    }
}

pub struct PrincipalView<'a>(pub &'a PrincipalSummary);
impl Serialize for PrincipalView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("Principal", 6)?;
        value.serialize_field("principalId", &self.0.principal_id)?;
        value.serialize_field("matrixUserId", &self.0.matrix_user_id)?;
        value.serialize_field(
            "kind",
            if self.0.kind == crossfire_domain::identity::PrincipalKind::Human {
                "human"
            } else {
                "agent"
            },
        )?;
        value.serialize_field("displayName", &self.0.display_name)?;
        value.serialize_field("ownerId", &self.0.owner_id)?;
        value.serialize_field("ownerMatrixId", &self.0.owner_matrix_id)?;
        value.end()
    }
}
