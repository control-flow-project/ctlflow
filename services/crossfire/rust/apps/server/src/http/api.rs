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
pub fn secure(response: &mut Response<Body>, request_id: &str) -> Result<()> {
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        hyper::header::HeaderValue::from_static("no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        hyper::header::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        hyper::header::HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        "x-request-id",
        hyper::header::HeaderValue::from_str(request_id)
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Invalid response identity"))?,
    );
    Ok(())
}
pub async fn handle(
    state: Arc<State>,
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
    secure(&mut response, &request_id)?;
    Ok(response)
}
async fn apply(
    state: &State,
    input: Request<Incoming>,
    peer: Peer,
    request_id: &str,
) -> Result<Response<Body>> {
    security::host(input.headers(), &state.configuration.public_origin)?;
    security::same_origin(input.headers(), &state.configuration.public_origin, false)?;
    let path = request::path(&input)?;
    let selection = request::select(input.method(), path)?;
    let operation = selection.operation;
    if operation.auth == Authentication::Public && input.method() != Method::GET {
        state.rate.admit(peer, input.headers(), identity::now()?)?;
    }
    if [OperationId::CreateSession, OperationId::ClaimInvitation].contains(&operation.id) {
        security::same_origin(input.headers(), &state.configuration.public_origin, true)?;
    }
    let auth = security::authenticate(
        &state.repository,
        &state.matrix,
        input.headers(),
        input.method(),
        operation.auth,
        &state.configuration.public_origin,
    )
    .await?;
    selection.validate()?;
    let query = request::Query::parse(
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
            if security::single(input.headers(), "content-type")?
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
