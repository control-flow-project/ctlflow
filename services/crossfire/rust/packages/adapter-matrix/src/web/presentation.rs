use super::services::{WebRepositoryAccess, WebServices};
use crossfire_adapter_http::{
    routing as request, security,
    server::{self, Body, Method, Request, Response},
};
use crossfire_domain::{
    member::invitation, messaging::MessagingAuthority, port::CoreRepository,
    room_access::operations::RoomOperations,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
pub async fn handle<Incoming>(
    state: &WebServices<impl WebRepositoryAccess, impl MessagingAuthority, impl RoomOperations>,
    input: &Request<Incoming>,
) -> Result<Option<Response<Body>>> {
    let path = request::path(input)?;
    let head = input.method() == Method::HEAD;
    let origin = state
        .configuration
        .public_origin
        .as_str()
        .trim_end_matches('/');
    if path == "/config.json"
        || path
            == format!(
                "/config.{}.json",
                state
                    .configuration
                    .public_origin
                    .host_str()
                    .unwrap_or_default()
            )
    {
        method(input.method())?;
        let claim = security::invitation(input.headers())?;
        let (invited, open) = state.repository.with(|repo| {
            let now = identity::now()?;
            let invited = match claim.as_ref() {
                None => false,
                Some(claim) => match invitation::verify(repo, &claim.id, &claim.secret, now) {
                    Ok(_) => true,
                    Err(error)
                        if matches!(
                            error.code,
                            ErrorCode::Unauthorized | ErrorCode::Forbidden | ErrorCode::Missing
                        ) =>
                    {
                        false
                    }
                    Err(error) => return Err(error),
                },
            };
            let open = repo
                .policy()?
                .is_some_and(|value| value.signup_mode == "open");
            Ok((invited, open))
        })?;
        let mut result = json!({"brand":"crossfire","default_theme":"light"});
        if let Some(presentation) = state.element.presentation.as_object() {
            for (key, value) in presentation {
                result[key] = value.clone();
            }
        }
        for (key, value) in [
            (
                "custom_translations_url",
                json!("/manage/assets/element-translations.json"),
            ),
            (
                "default_server_config",
                json!({"m.homeserver":{"base_url":origin,"server_name":state.configuration.server_name}}),
            ),
            ("disable_custom_urls", json!(true)),
            ("disable_guests", json!(true)),
            ("disable_login_language_selector", json!(true)),
            ("disable_3pid_login", json!(true)),
            ("disable_registration", json!(!invited && !open)),
            ("room_directory", json!({"servers":[]})),
        ] {
            result[key] = value;
        }
        return Ok(Some(json_response(result, head)?));
    }
    Ok(None)
}
fn method(method: &Method) -> Result<()> {
    if [Method::GET, Method::HEAD].contains(method) {
        Ok(())
    } else {
        Err(Failure::new(ErrorCode::MethodNotAllowed, "Use GET or HEAD"))
    }
}
fn json_response(value: Value, head: bool) -> Result<Response<Body>> {
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Presentation cannot be encoded"))?;
    Response::builder()
        .status(200)
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .header("content-length", bytes.len())
        .body(if head {
            server::empty()
        } else {
            server::full(bytes)
        })
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Presentation response cannot be constructed",
            )
        })
}
