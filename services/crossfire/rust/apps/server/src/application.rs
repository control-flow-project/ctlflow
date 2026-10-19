use crate::{http::api, platform, request, state::State};
use crossfire_adapter_http::{
    assets, security,
    server::{Body, Incoming, Method, Peer, Request, Response, header},
};
use crossfire_domain::messaging::MessagingAuthority;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use std::sync::Arc;

pub async fn handle<M: MessagingAuthority>(
    state: Arc<State<M>>,
    input: Request<Incoming>,
    peer: Peer,
) -> Result<Response<Body>> {
    let request_id = identity::id();
    match apply(state, input, peer, &request_id).await {
        Ok(response) => Ok(response),
        Err(error) => {
            let mut response = api::failure(error, &request_id)?;
            security::secure(&mut response, &request_id)?;
            Ok(response)
        }
    }
}
async fn apply<M: MessagingAuthority>(
    state: Arc<State<M>>,
    input: Request<Incoming>,
    peer: Peer,
    request_id: &str,
) -> Result<Response<Body>> {
    security::host(input.headers(), &state.configuration.public_origin)?;
    let path = request::path(&input)?.to_owned();
    if path.starts_with("/api/") {
        return api::handle(state, input, peer, request_id.to_owned()).await;
    }
    if path.starts_with("/onboarding/") {
        security::same_origin(input.headers(), &state.configuration.public_origin, false)?;
        return platform::handle(&state, &input)
            .await?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Route not found"));
    }
    if path == "/manage" || path.starts_with("/manage/") {
        if ![Method::GET, Method::HEAD].contains(input.method()) {
            return Err(Failure::new(ErrorCode::MethodNotAllowed, "Use GET or HEAD"));
        }
        let asset = if let Some(path) = path.strip_prefix("/manage/assets/") {
            format!("/assets/{path}")
        } else {
            "/index.html".to_owned()
        };
        let mut response = assets::serve(
            &state.assets.web,
            &request::decode(&asset)?,
            input.method() == Method::HEAD,
            state.stop.child_token(),
        )?;
        response.headers_mut().insert(
            "referrer-policy",
            hyper::header::HeaderValue::from_static("no-referrer"),
        );
        response.headers_mut().insert(
            "x-frame-options",
            hyper::header::HeaderValue::from_static("DENY"),
        );
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, hyper::header::HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"));
        return Ok(response);
    }
    state
        .backend
        .handle(input, peer, request_id.to_owned())
        .await
}
