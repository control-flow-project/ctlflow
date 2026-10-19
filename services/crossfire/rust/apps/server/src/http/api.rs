use super::{binary, context::Context, dispatch, reply};
use crate::{request, security, state::State};
use crossfire_adapter_http::server::{
    self, Body, Incoming, Method, Peer, Request, Response, header,
};
use crossfire_contracts::{
    envelope,
    operations::{Authentication, OperationId},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::sync::Arc;

pub fn failure(error: Failure, request_id: &str) -> Result<Response<Body>> {
    let mut response = Response::builder()
        .status(envelope::http_status(error.code))
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8");
    if error.code == ErrorCode::RateLimit {
        response = response.header(header::RETRY_AFTER, "60");
    }
    response
        .body(server::full(
            serde_json::to_vec(&envelope::ErrorResponse {
                error,
                meta: envelope::metadata(request_id.to_owned()),
            })
            .map_err(|_| {
                Failure::new(ErrorCode::Unavailable, "Failure response cannot be encoded")
            })?,
        ))
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Failure response cannot be constructed",
            )
        })
}
pub async fn handle(
    state: Arc<State<impl crossfire_domain::messaging::MessagingAuthority>>,
    input: Request<Incoming>,
    peer: Peer,
    request_id: String,
) -> Result<Response<Body>> {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        apply(&state, input, peer, &request_id),
    )
    .await
    .map_err(|_| {
        Failure::new(
            ErrorCode::Unavailable,
            "HTTP operation exceeded its finite deadline",
        )
    })
    .and_then(|result| result);
    let mut response = match result {
        Ok(value) => value,
        Err(error) => failure(error, &request_id)?,
    };
    crossfire_adapter_http::security::secure(&mut response, &request_id)?;
    Ok(response)
}
async fn apply(
    state: &State<impl crossfire_domain::messaging::MessagingAuthority>,
    input: Request<Incoming>,
    peer: Peer,
    request_id: &str,
) -> Result<Response<Body>> {
    crossfire_adapter_http::security::host(input.headers(), &state.configuration.public_origin)?;
    crossfire_adapter_http::security::same_origin(
        input.headers(),
        &state.configuration.public_origin,
        false,
    )?;
    let path = request::path(&input)?;
    let selection = request::select(input.method(), path)?;
    let operation = selection.operation;
    if operation.auth == Authentication::Public && input.method() != Method::GET {
        state.rate.admit(peer, input.headers(), identity::now()?)?;
    }
    if [
        OperationId::CreateSession,
        OperationId::ClaimInvitation,
        OperationId::AuthenticateBackend,
    ]
    .contains(&operation.id)
    {
        crossfire_adapter_http::security::same_origin(
            input.headers(),
            &state.configuration.public_origin,
            true,
        )?;
    }
    let auth = security::authenticate(
        &state.repository,
        state.messaging.as_ref(),
        input.headers(),
        input.method(),
        operation.auth,
        &state.configuration.public_origin,
    )
    .await?;
    selection.validate()?;
    let query = crossfire_adapter_http::query::Query::parse(
        input.uri().query(),
        crossfire_contracts::query::operations::fields(operation.id),
    )?;
    let mutation = input.method() != Method::GET;
    let result = if operation.binary {
        let (parts, body) = input.into_parts();
        let source = binary::Input::new(&parts.headers, body, operation.request_bytes)?;
        let actor = auth.actor()?;
        state
            .publications()
            .upload(
                actor,
                selection.parameter("publicationId")?,
                selection.parameter("fileId")?,
                source,
            )
            .await?;
        reply::of(json!({"uploaded":true}))?
    } else {
        let value = if mutation {
            if crossfire_adapter_http::security::single(input.headers(), "content-type")?
                .is_none_or(|value| value.split(';').next() != Some("application/json"))
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Expected application/json",
                ));
            }
            server::json(input.into_body(), operation.request_bytes).await?
        } else {
            json!({})
        };
        let context = Context {
            state,
            selection,
            auth,
            query,
            input: value,
            request_id: request_id.to_owned(),
        };
        let reply = dispatch::invoke(&context).await?;
        if reply.pagination.is_some() != operation.collection {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Response pagination does not match the declared contract",
            ));
        }
        reply
    };
    if mutation {
        state.changed.notify_waiters();
    }
    reply::response(result, request_id, operation.status)
}
