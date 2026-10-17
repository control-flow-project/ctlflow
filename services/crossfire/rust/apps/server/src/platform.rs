use crate::{
    assets, registration,
    request::{self, Query},
    state::State,
};
use crossfire_adapter_http::server::{Body, Method, Request, Response};
use crossfire_contracts::{onboarding, validation as check};
use crossfire_domain::{
    identity::{PrincipalKind, Status},
    member::invitation,
    port::{AuthorizationRepository, CoreRepository, RepositoryAccess},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
pub async fn handle<Incoming>(
    state: &State,
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
        let claim = registration::invitation(input.headers())?;
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
        if let Some(presentation) = state.assets.presentation.as_object() {
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
        return Ok(Some(json(result, head)?));
    }
    let prefix = format!("/onboarding/{}/", state.release.manifest.release);
    if let Some(name) = path.strip_prefix(&prefix) {
        method(input.method())?;
        let bytes = if name == "manifest.json" {
            Some(bytes::Bytes::from(
                serde_json::to_vec(&state.release.manifest).map_err(|_| {
                    Failure::new(ErrorCode::Unavailable, "Release metadata cannot be encoded")
                })?,
            ))
        } else {
            state
                .release
                .files
                .get(name)
                .map(|value| bytes::Bytes::from_owner(std::sync::Arc::clone(value)))
        };
        if let Some(bytes) = bytes {
            return Ok(Some(assets::bytes(
                bytes,
                if name == "manifest.json" {
                    "application/json; charset=utf-8"
                } else {
                    "text/plain; charset=utf-8"
                },
                "public, max-age=31536000, immutable",
                head,
            )?));
        }
        return Err(Failure::new(
            ErrorCode::Missing,
            "Release artifact not found",
        ));
    }
    if ["/onboarding/setup", "/onboarding/setup.json"].contains(&path) {
        method(input.method())?;
        let query = Query::parse(input.uri().query(), &["ownerMatrixId"])?;
        let owner = query.get("ownerMatrixId").ok_or_else(|| {
            Failure::new(ErrorCode::Invalid, "Exactly one ownerMatrixId is required")
        })?;
        check::matrix_user_id(&json!(owner))?;
        let instructions = state.repository.with(|repo| {
            repo.principal_by_matrix_id(owner)?
                .filter(|value| {
                    value.kind == PrincipalKind::Human && value.status == Status::Active
                })
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Forbidden,
                        "An active registered human owner is required",
                    )
                })?;
            Ok(repo
                .policy()?
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Onboarding policy unavailable")
                })?
                .agent_instructions)
        })?;
        return Ok(Some(if path.ends_with(".json") {
            json(
                onboarding::descriptor(
                    origin,
                    owner,
                    &state.release.manifest.version,
                    &instructions,
                ),
                head,
            )?
        } else {
            assets::bytes(
                onboarding::guide(
                    origin,
                    owner,
                    &state.release.manifest.version,
                    &instructions,
                ),
                "text/plain; charset=utf-8",
                "no-store",
                head,
            )?
        }));
    }
    if path == "/.well-known/matrix/client" {
        method(input.method())?;
        return Ok(Some(json(
            json!({"m.homeserver":{"base_url":origin}}),
            head,
        )?));
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
fn json(value: Value, head: bool) -> Result<Response<Body>> {
    assets::bytes(
        serde_json::to_vec(&value).map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Platform response cannot be encoded",
            )
        })?,
        "application/json; charset=utf-8",
        "no-store",
        head,
    )
}
