use crate::server::{HeaderMap, header};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
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

pub fn invitation(
    headers: &hyper::HeaderMap,
) -> Result<Option<crossfire_domain::member::signup::Claim>> {
    let Some(value) = cookie(headers, INVITATION_COOKIE)? else {
        return Ok(None);
    };
    let Some((id, claim)) = value.expose().split_once('.') else {
        return Ok(None);
    };
    if crossfire_contracts::validation::identifier(&serde_json::json!(id)).is_err()
        || crossfire_contracts::validation::secret(&serde_json::json!(claim)).is_err()
    {
        return Ok(None);
    }
    Ok(Some(crossfire_domain::member::signup::Claim {
        id: id.to_owned(),
        secret: Secret::new(claim.to_owned()),
    }))
}

pub fn secure(
    response: &mut crate::server::Response<crate::server::Body>,
    request_id: &str,
) -> Result<()> {
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
