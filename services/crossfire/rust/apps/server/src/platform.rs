use crate::{
    request::{self},
    state::State,
};
use crossfire_adapter_http::query::Query;
use crossfire_adapter_http::server::{Body, Method, Request, Response};
use crossfire_contracts::{onboarding, validation as check};
use crossfire_domain::port::AuthorizationRepository;
use crossfire_domain::{
    identity::{PrincipalKind, Status},
    port::{CoreRepository, RepositoryAccess},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
pub async fn handle<Incoming>(
    state: &State<impl crossfire_domain::messaging::MessagingAuthority>,
    input: &Request<Incoming>,
) -> Result<Option<Response<Body>>> {
    let path = request::path(input)?;
    let head = input.method() == Method::HEAD;
    let origin = state
        .configuration
        .public_origin
        .as_str()
        .trim_end_matches('/');
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
            return Ok(Some(crossfire_adapter_http::assets::bytes(
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
        let query = Query::parse(input.uri().query(), &["ownerBackendUserId"])?;
        let owner = query.get("ownerBackendUserId").ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "Exactly one ownerBackendUserId is required",
            )
        })?;
        check::backend_user_id(&json!(owner))?;
        let instructions = state.repository.with(|repo| {
            repo.principal_by_backend_user_id(owner)?
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
            crossfire_adapter_http::assets::bytes(
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
    crossfire_adapter_http::assets::bytes(
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
