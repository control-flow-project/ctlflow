use crossfire_adapter_http::server::{HeaderMap, Method, header};
use crossfire_contracts::operations::Authentication;
use crossfire_domain::{
    fleet::{authority, values::FleetActor},
    identity::{Actor, PrincipalKind},
    port::{BackendUserIdentity, CoreRepository, FleetRepository, RepositoryAccess},
    session,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use url::Url;

use crossfire_adapter_http::security::{SESSION_COOKIE, bearer, cookie, same_origin, single};
pub struct Authenticated {
    pub actor: Option<Actor>,
    pub controller: Option<FleetActor>,
    pub session: Option<session::Authenticated>,
    pub cookie: Option<Secret>,
}
impl Authenticated {
    pub fn actor(&self) -> Result<&Actor> {
        self.actor.as_ref().ok_or_else(|| {
            Failure::new(ErrorCode::Unauthorized, "A registered identity is required")
        })
    }
    pub fn fleet(&self) -> Result<FleetActor> {
        self.controller
            .clone()
            .or_else(|| self.actor.clone().map(FleetActor::Principal))
            .ok_or_else(|| {
                Failure::new(ErrorCode::Unauthorized, "Fleet authentication is required")
            })
    }
}
pub async fn authenticate<A: RepositoryAccess>(
    repository: &A,
    messaging: &impl BackendUserIdentity,
    headers: &HeaderMap,
    method: &Method,
    mode: Authentication,
    origin: &Url,
) -> Result<Authenticated>
where
    A::Repository: CoreRepository + FleetRepository,
{
    if headers.contains_key(header::AUTHORIZATION) && headers.contains_key(header::COOKIE) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Do not mix cookie and bearer authentication",
        ));
    }
    let mut result = Authenticated {
        actor: None,
        controller: None,
        session: None,
        cookie: cookie(headers, SESSION_COOKIE)?,
    };
    if mode == Authentication::Public {
        if headers.contains_key(header::AUTHORIZATION) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "This operation does not accept bearer authentication",
            ));
        }
        return Ok(result);
    }
    if headers.contains_key(header::AUTHORIZATION) {
        if mode == Authentication::Human {
            return Err(Failure::new(
                ErrorCode::Unauthorized,
                "This operation requires human management authentication",
            ));
        }
        let token = bearer(headers)?;
        if mode == Authentication::Fleet {
            result.controller =
                Some(repository.with(|repo| authority::authenticate_controller(repo, &token))?);
        } else {
            result.actor = Some(
                session::native(
                    repository,
                    messaging,
                    &token,
                    Some(PrincipalKind::Agent),
                    identity::now,
                )
                .await?,
            );
        }
        return Ok(result);
    }
    if mode == Authentication::Agent {
        return Err(Failure::new(
            ErrorCode::Unauthorized,
            "Agent bearer authentication is required",
        ));
    }
    let token = result.cookie.as_ref().ok_or_else(|| {
        Failure::new(
            ErrorCode::Unauthorized,
            "A human management session is required",
        )
    })?;
    let session = repository.with(|repo| session::authenticate(repo, token, identity::now()?))?;
    if method != Method::GET {
        same_origin(headers, origin, true)?;
        let csrf = single(headers, "x-crossfire-csrf")?.map(|value| Secret::new(value.to_owned()));
        if csrf.as_ref() != Some(&session.csrf_secret) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Same-origin CSRF-protected mutation required",
            ));
        }
    }
    result.actor = Some(session.actor.clone());
    result.session = Some(session);
    Ok(result)
}
