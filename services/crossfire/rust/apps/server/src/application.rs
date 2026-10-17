use crate::{
    assets, http::api, matrix_routes, platform, registration, request, security, state::State,
};
use crossfire_adapter_http::server::{Body, Incoming, Method, Peer, Request, Response, header};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use std::sync::Arc;

pub async fn handle(
    state: Arc<State>,
    input: Request<Incoming>,
    peer: Peer,
) -> Result<Response<Body>> {
    let request_id = identity::id();
    match apply(state, input, peer, &request_id).await {
        Ok(response) => Ok(response),
        Err(error) => {
            let mut response = api::failure(error, &request_id)?;
            api::secure(&mut response, &request_id)?;
            Ok(response)
        }
    }
}
async fn apply(
    state: Arc<State>,
    input: Request<Incoming>,
    peer: Peer,
    request_id: &str,
) -> Result<Response<Body>> {
    security::host(input.headers(), &state.configuration.public_origin)?;
    let path = request::path(&input)?.to_owned();
    let native = path.starts_with("/_matrix/");
    let decoded = if native {
        request::decode(&path)?
    } else {
        path.clone()
    };
    let registered = registration::handles(&path);
    let controlled = matrix_routes::handles(&path, input.method());
    if native && registration::sensitive(&decoded, input.method()) && !registered && !controlled {
        return registration::native(
            404,
            json!({"errcode":"M_UNRECOGNIZED","error":"Unsupported native authentication or profile path"}),
        );
    }
    let managed = path.starts_with("/api/")
        || path.starts_with("/onboarding/")
        || path == "/config.json"
        || path
            == format!(
                "/config.{}.json",
                state
                    .configuration
                    .public_origin
                    .host_str()
                    .unwrap_or_default()
            )
        || registered
        || controlled;
    if managed {
        security::same_origin(input.headers(), &state.configuration.public_origin, false)?;
    }
    if registered {
        if input.method() == Method::POST
            && let Err(error) = state.rate.admit(peer, input.headers(), identity::now()?)
        {
            let limited = error.code == ErrorCode::RateLimit;
            let mut response = registration::native(
                if limited { 429 } else { 403 },
                json!({"errcode":if limited { "M_LIMIT_EXCEEDED" } else { "M_FORBIDDEN" }, "error":error.message}),
            )?;
            if limited {
                response.headers_mut().insert(
                    header::RETRY_AFTER,
                    hyper::header::HeaderValue::from_static("60"),
                );
            }
            api::secure(&mut response, request_id)?;
            return Ok(response);
        }
        return registration::handle(&state, input, request_id).await;
    }
    if controlled {
        return matrix_routes::handle(&state, input, request_id).await;
    }
    if path.starts_with("/api/") {
        return api::handle(state, input, peer, request_id.to_owned()).await;
    }
    if let Some(response) = platform::handle(&state, &input).await? {
        return Ok(response);
    }
    if native {
        let origin = &state.configuration.public_origin;
        return state
            .matrix_proxy
            .forward(
                input,
                &origin[url::Position::BeforeHost..url::Position::AfterPort],
            )
            .await;
    }
    if managed {
        return Err(Failure::new(ErrorCode::Missing, "Route not found"));
    }
    if ![Method::GET, Method::HEAD].contains(input.method()) {
        return Err(Failure::new(ErrorCode::MethodNotAllowed, "Use GET or HEAD"));
    }
    let management = path == "/manage" || path.starts_with("/manage/");
    let root = if management {
        &state.assets.web
    } else {
        &state.assets.element
    };
    let path = if management {
        if path.starts_with("/manage/assets/") {
            path.strip_prefix("/manage")
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Asset not found"))?
        } else {
            "/index.html"
        }
    } else {
        &path
    };
    let decoded = request::decode(path)?;
    let mut response = assets::serve(
        root,
        &decoded,
        input.method() == Method::HEAD,
        state.stop.child_token(),
    )?;
    let headers = response.headers_mut();
    headers.insert(
        "referrer-policy",
        hyper::header::HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        "x-frame-options",
        hyper::header::HeaderValue::from_static("DENY"),
    );
    if management {
        headers.insert(header::CONTENT_SECURITY_POLICY, hyper::header::HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"));
    } else if ["/usercontent/", "/usercontent/index.html"].contains(&path) {
        headers.remove("x-frame-options");
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            hyper::header::HeaderValue::from_static("frame-ancestors 'self'"),
        );
    }
    Ok(response)
}
