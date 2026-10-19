use crate::{
    delivery_policy::{Policy, Room},
    profile::Profile,
};
use crossfire_contracts::{call::Call, delivery_policy, operations::OperationId};
use crossfire_domain::identity::Status;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{collections::BTreeMap, future::Future};
use tokio_util::sync::CancellationToken;

pub trait Coordination: Send + Sync {
    fn origin(&self) -> &str;
    fn call(
        &self,
        request: &Call,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
}

pub fn identity(value: &Value) -> Result<crossfire_domain::read::values::PrincipalIdentity> {
    use crossfire_contracts::validation as check;
    use crossfire_domain::identity::PrincipalKind;
    let value = check::object(
        value,
        &[
            "backendUserId",
            "kind",
            "ownerBackendUserId",
            "displayName",
            "ownerDisplayName",
        ],
        &[],
    )?;
    let optional = |name: &str| {
        if value[name].is_null() {
            Ok(None)
        } else {
            check::text(&value[name], 1, 4096).map(|value| Some(value.to_owned()))
        }
    };
    let kind = match check::choice(&value["kind"], &["human", "agent", "unknown"])? {
        "human" => Some(PrincipalKind::Human),
        "agent" => Some(PrincipalKind::Agent),
        _ => None,
    };
    let owner = optional("ownerBackendUserId")?;
    if let Some(owner) = &owner {
        check::backend_user_id(&json!(owner))?;
    }
    if (kind == Some(PrincipalKind::Agent)) != owner.is_some() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Resolved agent ownership is inconsistent",
        ));
    }
    Ok(crossfire_domain::read::values::PrincipalIdentity {
        backend_user_id: check::backend_user_id(&value["backendUserId"])?.to_owned(),
        kind,
        owner_backend_user_id: owner,
        display_name: optional("displayName")?,
        owner_display_name: optional("ownerDisplayName")?,
    })
}
pub async fn senders(
    coordination: &impl Coordination,
    events: &[crate::events::Event],
    stop: CancellationToken,
) -> Result<BTreeMap<String, crossfire_domain::read::values::PrincipalIdentity>> {
    let ids: Vec<_> = events
        .iter()
        .map(|event| event.sender.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut result = BTreeMap::new();
    for requested in ids.chunks(100) {
        let mut call = Call::new(OperationId::ResolvePrincipals);
        call.body = Some(json!({"backendUserIds":requested}));
        let response = coordination.call(&call, stop.clone()).await?;
        let parsed = crossfire_contracts::validation::list(&response, 1, 100)?
            .iter()
            .map(identity)
            .collect::<Result<Vec<_>>>()?;
        if parsed.len() != requested.len()
            || parsed
                .iter()
                .any(|value| !requested.contains(&value.backend_user_id.as_str()))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Sender resolution differs from the exact requested identities",
            ));
        }
        for value in parsed {
            if result
                .insert(value.backend_user_id.clone(), value)
                .is_some()
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Duplicate resolved sender identity",
                ));
            }
        }
    }
    Ok(result)
}
pub async fn policy(
    coordination: &impl Coordination,
    profile: &Profile,
    stop: CancellationToken,
) -> Result<Policy> {
    let result = coordination
        .call(&Call::agent(OperationId::DeliveryPolicy, &profile.id), stop)
        .await?;
    let result = delivery_policy::parse(&result)?;
    if result.agent_id != profile.id
        || result.backend_user_id != profile.account.user_id
        || result.owner_backend_user_id != profile.settings.owner
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Delivery policy does not belong to this exact agent and owner",
        ));
    }
    Ok(Policy {
        active: result.status == Status::Active && result.owner_status == Status::Active,
        mode: result.mode,
        rooms: result
            .grants
            .into_iter()
            .map(|grant| {
                (
                    grant.room_id,
                    Room {
                        muted: grant.muted,
                        access: grant.access,
                        native_access: grant.native_access,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
        senders: result.sender_backend_user_ids.into_iter().collect(),
        max_message_bytes: result.max_message_bytes,
        idle_timeout_seconds: result.idle_timeout_seconds,
        owner_conversation: result.owner_conversation,
    })
}
