use base64::{Engine, engine::general_purpose::STANDARD};
use crossfire_adapter_http::server::{self, Body, Response};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use sha2::{Digest, Sha256};
const STYLE: &str = "body{margin:0;background:#f8f6ef;color:#242c2c;font:18px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:12vh auto;padding:2rem}h1{font-size:2rem;line-height:1.2}button{background:#f0dbe9;color:#242c2c;border:1px solid #242c2c;border-radius:4px;padding:.8rem 1.2rem;font:inherit;cursor:pointer}strong{overflow-wrap:anywhere}";
const COMPLETION: &str = "if(window.onAuthDone){window.onAuthDone()}else if(window.opener&&window.opener.postMessage){window.opener.postMessage(\"authDone\",location.origin)}";
fn escape(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&#39;"),
            _ => result.push(character),
        }
    }
    result
}
fn send(status: u16, title: &str, body: String, completed: bool) -> Result<Response<Body>> {
    let hash = |value: &str| {
        format!(
            "'sha256-{}'",
            STANDARD.encode(Sha256::digest(value.as_bytes()))
        )
    };
    let policy = format!(
        "default-src 'none'; style-src {}; script-src {}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        hash(STYLE),
        if completed {
            hash(COMPLETION)
        } else {
            "'none'".to_owned()
        }
    );
    let script = if completed {
        format!("<script>{COMPLETION}</script>")
    } else {
        String::new()
    };
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>{STYLE}</style></head><body><main><h1>{title}</h1>{body}</main>{script}</body></html>"
    );
    Response::builder()
        .status(status)
        .header("content-type", "text/html; charset=utf-8")
        .header("referrer-policy", "same-origin")
        .header("x-frame-options", "DENY")
        .header("content-security-policy", policy)
        .body(server::full(html))
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Signup page cannot be constructed"))
}
pub fn error(status: u16, message: &str) -> Result<Response<Body>> {
    send(
        status,
        "Unable to continue",
        format!("<p>{}</p>", escape(message)),
        false,
    )
}
pub fn confirm(username: &str, server: &str, nonce: &str, invited: bool) -> Result<Response<Body>> {
    let title = if invited {
        "Confirm your invitation"
    } else {
        "Confirm your account"
    };
    let label = if invited {
        "Confirm invitation"
    } else {
        "Create account"
    };
    let suffix = if invited {
        " using your private invitation"
    } else {
        ""
    };
    send(
        200,
        title,
        format!(
            "<p>Create <strong>@{}:{}</strong>{suffix}?</p><p>Your username and password are chosen in Element. Confirm this account, then return to Element to finish.</p><form method=\"post\"><input type=\"hidden\" name=\"nonce\" value=\"{}\"><button type=\"submit\">{label}</button></form>",
            escape(username),
            escape(server),
            escape(nonce)
        ),
        false,
    )
}
pub fn completed() -> Result<Response<Body>> {
    send(
        200,
        "Account confirmed",
        "<p>Return to Element to finish creating your account.</p>".to_owned(),
        true,
    )
}
