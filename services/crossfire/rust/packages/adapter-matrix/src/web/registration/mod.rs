mod page;
mod sessions;
use super::services::{WebRepositoryAccess, WebServices};
use crossfire_adapter_http::server::{self, Body, Incoming, Method, Request, Response, header};
use crossfire_adapter_http::{query::Query, routing as request, security};
use crossfire_contracts::member::ClaimFingerprint;
use crossfire_domain::{
    member::{invitation, signup},
    port::CoreRepository,
};
use crossfire_domain::{messaging::MessagingAuthority, room_access::operations::RoomOperations};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
pub use sessions::Registration;

pub const STAGE: &str = "org.crossfire.login.registration";
pub const REGISTER_PATH: &str = "/_matrix/client/v3/register";
pub const FALLBACK_PATH: &str =
    "/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web";
pub fn handles(path: &str) -> bool {
    [REGISTER_PATH, FALLBACK_PATH].contains(&path)
}
pub fn sensitive(path: &str, method: &Method) -> bool {
    let path = path.trim_end_matches('/');
    path.starts_with("/_matrix/client/")
        && (path.ends_with("/register")
            || path.ends_with("/auth/org.crossfire.login.registration/fallback/web")
            || *method == Method::PUT
                && path.contains("/profile/")
                && path.ends_with("/displayname"))
}
pub fn native(status: u16, value: Value) -> Result<Response<Body>> {
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Native response cannot be encoded"))?;
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(server::full(bytes))
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Native response cannot be constructed",
            )
        })
}
fn failure(error: Failure) -> Result<Response<Body>> {
    let (status, code) = match error.code {
        ErrorCode::Forbidden | ErrorCode::Unauthorized => (403, "M_FORBIDDEN"),
        ErrorCode::Conflict | ErrorCode::NameCollision => (400, "M_USER_IN_USE"),
        ErrorCode::Native => (502, "M_UNKNOWN"),
        ErrorCode::Unavailable => (503, "M_UNKNOWN"),
        ErrorCode::RateLimit => (429, "M_LIMIT_EXCEEDED"),
        _ => (400, "M_INVALID_PARAM"),
    };
    native(status, json!({"errcode":code,"error":error.message}))
}
pub async fn handle(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: Request<Incoming>,
    request_id: &str,
) -> Result<Response<Body>> {
    let path = request::path(&input)?.to_owned();
    if path == REGISTER_PATH {
        register(state, input, request_id).await
    } else {
        fallback(state, input).await
    }
}
async fn register(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: Request<Incoming>,
    request_id: &str,
) -> Result<Response<Body>> {
    if input.method() != Method::POST {
        let mut response = native(405, json!({"errcode":"M_UNRECOGNIZED","error":"Use POST"}))?;
        response.headers_mut().insert(
            header::ALLOW,
            "POST"
                .parse()
                .map_err(|_| Failure::new(ErrorCode::Unavailable, "Invalid method metadata"))?,
        );
        return Ok(response);
    }
    let guest = input.uri().query().is_some_and(|query| {
        url::form_urlencoded::parse(query.as_bytes())
            .any(|(key, value)| key == "kind" && value == "guest")
    });
    if security::single(input.headers(), "content-type")?
        .is_none_or(|value| value.split(';').next() != Some("application/json"))
    {
        return native(400, json!({"errcode":"M_BAD_JSON","error":"Expected JSON"}));
    }
    let body = match server::json(input.into_body(), 2097152).await {
        Ok(value) => value,
        Err(error) => return native(400, json!({"errcode":"M_BAD_JSON","error":error.message})),
    };
    if guest || body.get("kind").and_then(Value::as_str) == Some("guest") {
        return native(
            403,
            json!({"errcode":"M_FORBIDDEN","error":"Guest registration is disabled"}),
        );
    }
    if state.repository.with(|repo| repo.policy())?.is_none() {
        return native(
            503,
            json!({"errcode":"M_UNKNOWN","error":"Signup policy unavailable"}),
        );
    }
    let (id, session) = match state.registration.prepare(&body, identity::now()?) {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    if !session.authorized {
        return native(
            401,
            json!({"session":id,"flows":[{"stages":[STAGE]}],"params":{},"completed":[]}),
        );
    }
    let Some(details) = session.details else {
        return native(
            400,
            json!({"errcode":"M_MISSING_PARAM","error":"Username and password are required"}),
        );
    };
    let _pending = match state.registration.acquire(&details.username) {
        Ok(value) => value,
        Err(error) => {
            return native(
                409,
                json!({"errcode":"M_USER_IN_USE","error":error.message}),
            );
        }
    };
    let details = signup::Details {
        username: details.username,
        password: details.password,
        display_name: details.display_name,
        native: serde_json::Map::from_iter([("deviceId".to_owned(), json!(details.device_id))]),
    };
    let result = match session.invitation {
        Some(claim) => signup::accept(
            &state.repository,
            state.messaging.as_ref(),
            &identity::now,
            &ClaimFingerprint,
            signup::InvitationInput {
                claim: &claim,
                details: &details,
                request_id,
            },
        )
        .await
        .map(|value| value.account),
        None => {
            signup::register(
                &state.repository,
                state.messaging.as_ref(),
                &identity::now,
                signup::OpenInput {
                    details: &details,
                    request_id,
                },
            )
            .await
        }
    };
    let account = match result {
        Ok(value) => value,
        Err(error) => return failure(error),
    };
    state.registration.remove(&id)?;
    state.changed.notify_waiters();
    let mut response = native(
        200,
        json!({"user_id":account.user_id,"access_token":account.access_token.expose(),"device_id":account.native.get("deviceId"),"home_server":state.configuration.server_name}),
    )?;
    response.headers_mut().insert(
        header::SET_COOKIE,
        security::session_cookie(None, security::INVITATION_COOKIE, 0)?,
    );
    Ok(response)
}
async fn fallback(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: Request<Incoming>,
) -> Result<Response<Body>> {
    let query = match Query::parse(input.uri().query(), &["session"]) {
        Ok(value) => value,
        Err(_) => {
            return page::error(
                400,
                "This signup session is invalid or expired. Return to Element and restart signup.",
            );
        }
    };
    let Some(id) = query.get("session") else {
        return page::error(
            400,
            "This signup session is invalid or expired. Return to Element and restart signup.",
        );
    };
    let id = id.to_owned();
    let session = state.registration.session(&id, identity::now()?)?;
    let Some(details) = session.as_ref().and_then(|value| value.details.as_ref()) else {
        return page::error(
            400,
            "This signup session is invalid or expired. Return to Element and restart signup.",
        );
    };
    if input.method() != Method::GET && input.method() != Method::POST {
        let mut response = page::error(405, "Use the invitation confirmation in Element.")?;
        response.headers_mut().insert(
            header::ALLOW,
            "GET, POST"
                .parse()
                .map_err(|_| Failure::new(ErrorCode::Unavailable, "Invalid method metadata"))?,
        );
        return Ok(response);
    }
    let claim = security::invitation(input.headers())?;
    let allowed = state.repository.with(|repo| match &claim {
        Some(claim) => {
            invitation::verify(repo, &claim.id, &claim.secret, identity::now()?).map(|_| true)
        }
        None => repo
            .policy()
            .map(|value| value.is_some_and(|value| value.signup_mode == "open")),
    });
    if !matches!(allowed, Ok(true)) {
        return page::error(
            403,
            "Open your complete private invitation link in this browser, then return to Element to finish signup.",
        );
    }
    if input.method() == Method::GET {
        let nonce = identity::secret()?;
        state
            .registration
            .confirm(&id, &claim, &nonce, identity::now()?)?;
        return page::confirm(
            &details.username,
            &state.configuration.server_name,
            nonce.expose(),
            claim.is_some(),
        );
    }
    if security::same_origin(input.headers(), &state.configuration.public_origin, true).is_err() {
        return page::error(
            403,
            "Confirm the invitation from this server’s signup page.",
        );
    }
    if security::single(input.headers(), "content-type")?
        .is_none_or(|value| value.split(';').next() != Some("application/x-www-form-urlencoded"))
    {
        return page::error(403, "Account confirmation expired. Reopen it from Element.");
    }
    let bytes = server::read(input.into_body(), 1024).await?;
    let form = std::str::from_utf8(&bytes)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid form encoding"))?;
    let form = Query::parse(Some(form), &["nonce"])?;
    if !state
        .registration
        .authorize(&id, &claim, form.get("nonce"), identity::now()?)?
    {
        return page::error(403, "Account confirmation expired. Reopen it from Element.");
    }
    let mut response = page::completed()?;
    response.headers_mut().insert(
        header::SET_COOKIE,
        security::session_cookie(None, security::INVITATION_COOKIE, 0)?,
    );
    Ok(response)
}
