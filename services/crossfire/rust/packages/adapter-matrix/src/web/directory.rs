use super::{
    registration,
    services::{WebRepositoryAccess, WebServices},
};
use crossfire_adapter_http::server::{self, Body, Incoming, Method, Request, Response};
use crossfire_adapter_http::{routing as request, security};
use crossfire_contracts::{identity::IntentHash, validation as check};
use crossfire_domain::{
    identity::PrincipalKind,
    member,
    port::CoreRepository,
    principal,
    read::{
        self,
        values::{DiscoveryFilter, Pagination},
    },
    session,
};
use crossfire_domain::{messaging::MessagingAuthority, room_access::operations::RoomOperations};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;

const DIRECTORY: &str = "/_matrix/client/v3/user_directory/search";
pub fn handles(path: &str, method: &Method) -> bool {
    path == DIRECTORY || *method == Method::PUT && profile(path).is_some()
}
fn profile(path: &str) -> Option<&str> {
    path.strip_prefix("/_matrix/client/v3/profile/")
        .and_then(|value| value.strip_suffix("/displayname"))
        .filter(|value| !value.is_empty() && !value.contains('/'))
}
fn reject(error: Failure) -> Result<Response<Body>> {
    let (status, code) = match error.code {
        ErrorCode::Unauthorized => (401, "M_UNKNOWN_TOKEN"),
        ErrorCode::Forbidden => (403, "M_FORBIDDEN"),
        ErrorCode::BodyTooLarge => (413, "M_TOO_LARGE"),
        ErrorCode::Native => (502, "M_UNKNOWN"),
        ErrorCode::Unavailable => (503, "M_UNKNOWN"),
        _ => (400, "M_INVALID_PARAM"),
    };
    registration::native(status, json!({"errcode":code,"error":error.message}))
}
pub async fn handle(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: Request<Incoming>,
    request_id: &str,
) -> Result<Response<Body>> {
    match apply(state, input, request_id).await {
        Ok(value) => Ok(value),
        Err(error) => reject(error),
    }
}
async fn apply(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: Request<Incoming>,
    request_id: &str,
) -> Result<Response<Body>> {
    let path = request::path(&input)?.to_owned();
    if input.uri().query().is_some_and(|value| !value.is_empty()) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Use native bearer authentication without query credentials",
        ));
    }
    let token = security::bearer(input.headers())?;
    let actor = session::native(
        &state.repository,
        state.messaging.as_ref(),
        &token,
        None,
        identity::now,
    )
    .await?;
    if security::single(input.headers(), "content-type")?
        .is_none_or(|value| value.split(';').next() != Some("application/json"))
    {
        return Err(Failure::new(ErrorCode::Invalid, "Expected JSON"));
    }
    if path == DIRECTORY {
        if input.method() != Method::POST {
            return registration::native(
                405,
                json!({"errcode":"M_UNRECOGNIZED","error":"Use POST"}),
            );
        }
        let value = server::json(input.into_body(), 2097152).await?;
        let value = check::object(&value, &["search_term"], &["limit"])?;
        let limit = value
            .get("limit")
            .map(|value| check::integer(value, 0, 100))
            .transpose()?
            .unwrap_or(10);
        let filter = DiscoveryFilter {
            pagination: Pagination {
                page: 1,
                size: limit.max(1),
            },
            kind: None,
            search: check::text(&value["search_term"], 0, 200)?,
            exclude_id: None,
        };
        let directory = state
            .repository
            .with(|repo| read::discovery::principals(repo, &actor, &filter, identity::now()?))?;
        let results: Vec<_> = directory
            .items
            .iter()
            .take(limit as usize)
            .map(|value| json!({"user_id":value.backend_user_id,"display_name":value.display_name}))
            .collect();
        return registration::native(
            200,
            json!({"limited":directory.total_items>results.len() as i64,"results":results}),
        );
    }
    if actor.kind == PrincipalKind::Agent {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Agent names are registered through owner-reviewed fleet enrollment",
        ));
    }
    let member = state
        .repository
        .with(|repo| repo.member_view(&actor.principal_id))?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Registered profile unavailable"))?;
    let user = request::decode(
        profile(&path)
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Unsupported native profile path"))?,
    )?;
    if user != member.principal.backend_user_id {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "You can only change your own profile",
        ));
    }
    let value = server::json(input.into_body(), 2097152).await?;
    let value = check::object(&value, &["displayname"], &[])?;
    let input = member::Change {
        expected_revision: member.principal.revision,
        status: None,
        display_name: Some(check::text(&value["displayname"], 1, 100)?.to_owned()),
        role: None,
    };
    state.repository.with(|repo| {
        member::change(
            repo,
            &actor,
            &actor.principal_id,
            &input,
            request_id,
            identity::now()?,
        )
    })?;
    principal::reconcile(
        &state.repository,
        state.messaging.as_ref(),
        &state.room_operations,
        &identity::now,
        &IntentHash,
        &actor.principal_id,
    )
    .await?;
    state.changed.notify_waiters();
    registration::native(200, json!({}))
}
