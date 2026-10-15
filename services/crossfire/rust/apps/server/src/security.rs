use crossfire_adapter_http::server::{HeaderMap, Method, header};
use crossfire_contracts::{operations::Authentication, validation};
use crossfire_domain::{
    fleet::{authority, values::FleetActor},
    identity::{Actor, PrincipalKind},
    port::{CoreRepository, FleetRepository, MatrixIdentity, RepositoryAccess},
    session,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use std::{collections::BTreeMap, net::IpAddr, sync::Mutex};
use url::Url;

pub const SESSION_COOKIE: &str = "__Host-crossfire";
pub const INVITATION_COOKIE: &str = "__Host-crossfire-invitation";

pub fn single<'a>(headers: &'a HeaderMap, key: &str) -> Result<Option<&'a str>> {
    let mut values = headers.get_all(key).iter();
    let first = values
        .next()
        .map(|value| {
            value
                .to_str()
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid request header"))
        })
        .transpose()?;
    if values.next().is_some() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicated request header",
        ));
    }
    Ok(first)
}
pub fn same_origin(headers: &HeaderMap, origin: &Url, required: bool) -> Result<()> {
    if match single(headers, "origin")? {
        Some(value) => value != origin.origin().ascii_serialization(),
        None => required,
    } {
        return Err(Failure::new(ErrorCode::Forbidden, "Invalid request origin"));
    }
    Ok(())
}
pub fn host(headers: &HeaderMap, origin: &Url) -> Result<()> {
    let expected = &origin[url::Position::BeforeHost..url::Position::AfterPort];
    if single(headers, "host")? != Some(expected) {
        return Err(Failure::new(ErrorCode::Forbidden, "Invalid request host"));
    }
    Ok(())
}
pub fn cookie(headers: &HeaderMap, name: &str) -> Result<Option<Secret>> {
    let Some(source) = single(headers, "cookie")? else {
        return Ok(None);
    };
    if source.len() > 16384 {
        return Err(Failure::new(ErrorCode::Invalid, "Cookie exceeds its bound"));
    }
    let mut found = None;
    for value in source.split(';') {
        if let Some((key, value)) = value.trim_matches(' ').split_once('=')
            && key == name
        {
            if found.is_some()
                || value.is_empty()
                || value
                    .chars()
                    .any(|character| character <= '\u{20}' || character == '\u{7f}')
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Invalid or duplicated authentication cookie",
                ));
            }
            found = Some(Secret::new(value.to_owned()));
        }
    }
    Ok(found)
}
pub fn bearer(headers: &HeaderMap) -> Result<Secret> {
    let value = single(headers, "authorization")?
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 8192
                && !value.chars().any(|character| {
                    validation::whitespace(character)
                        || character <= '\u{1f}'
                        || character == '\u{7f}'
                })
        });
    value
        .map(|value| Secret::new(value.to_owned()))
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Unauthorized,
                "Native bearer authentication is required",
            )
        })
}
pub fn session_cookie(
    secret: Option<&Secret>,
    name: &str,
    seconds: u32,
) -> Result<hyper::header::HeaderValue> {
    let value = format!(
        "{name}={}; Path=/; Max-Age={seconds}; HttpOnly; SameSite=Strict; Secure",
        secret.map_or("", Secret::expose)
    );
    hyper::header::HeaderValue::from_str(&value).map_err(|_| {
        Failure::new(
            ErrorCode::Unavailable,
            "Authentication cookie cannot be encoded",
        )
    })
}
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
    matrix: &impl MatrixIdentity,
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
                    matrix,
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
#[derive(Default)]
pub struct RateLimit(Mutex<BTreeMap<IpAddr, (u16, i64)>>);
impl RateLimit {
    pub fn admit(&self, address: IpAddr, now: i64) -> Result<()> {
        let mut records = self
            .0
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Request rate ownership failed"))?;
        records.retain(|_, (_, expiry)| *expiry > now);
        if !records.contains_key(&address) && records.len() >= 4096 {
            return Err(Failure::new(ErrorCode::RateLimit, "Request rate exceeded"));
        }
        let record = records
            .entry(address)
            .or_insert((0, now.saturating_add(60000)));
        record.0 = record.0.saturating_add(1);
        if record.0 > 120 {
            return Err(Failure::new(ErrorCode::RateLimit, "Request rate exceeded"));
        }
        Ok(())
    }
}
