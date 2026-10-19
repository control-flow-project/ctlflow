pub mod directory;
mod presentation;
pub mod registration;
pub mod services;

use crossfire_adapter_http::{
    assets,
    messaging::{BackendResponse, MessagingHttp},
    routing, security,
    server::{Body, Incoming, Method, Peer, Request, Response, header},
};
use crossfire_domain::{messaging::MessagingAuthority, room_access::operations::RoomOperations};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;
use services::{WebRepositoryAccess, WebServices};

impl<Access: WebRepositoryAccess, Messaging: MessagingAuthority, Operations: RoomOperations>
    WebServices<Access, Messaging, Operations>
{
    async fn apply(
        &self,
        input: Request<Incoming>,
        peer: Peer,
        request_id: &str,
    ) -> Result<Response<Body>> {
        let path = routing::path(&input)?.to_owned();
        let native = path.starts_with("/_matrix/");
        let decoded = if native {
            routing::decode(&path)?
        } else {
            path.clone()
        };
        let registered = registration::handles(&path);
        let controlled = directory::handles(&path, input.method());
        if native
            && registration::sensitive(&decoded, input.method())
            && (!registered && !controlled || decoded != path)
        {
            return registration::native(
                404,
                json!({"errcode":"M_UNRECOGNIZED","error":"Unsupported native authentication or profile path"}),
            );
        }
        if registered
            || controlled
            || path == "/config.json"
            || path
                == format!(
                    "/config.{}.json",
                    self.configuration
                        .public_origin
                        .host_str()
                        .unwrap_or_default()
                )
        {
            security::same_origin(input.headers(), &self.configuration.public_origin, false)?;
        }
        if registered {
            if input.method() == Method::POST
                && let Err(error) = self.rate.admit(peer, input.headers(), identity::now()?)
            {
                let limited = error.code == ErrorCode::RateLimit;
                let mut response = registration::native(
                    if limited { 429 } else { 403 },
                    json!({"errcode":if limited {"M_LIMIT_EXCEEDED"} else {"M_FORBIDDEN"},"error":error.message}),
                )?;
                if limited {
                    response.headers_mut().insert(
                        header::RETRY_AFTER,
                        hyper::header::HeaderValue::from_static("60"),
                    );
                }
                security::secure(&mut response, request_id)?;
                return Ok(response);
            }
            return registration::handle(self, input, request_id).await;
        }
        if controlled {
            return directory::handle(self, input, request_id).await;
        }
        if let Some(response) = presentation::handle(self, &input).await? {
            return Ok(response);
        }
        if native {
            let origin = &self.configuration.public_origin;
            return self
                .proxy
                .forward(
                    input,
                    &origin[url::Position::BeforeHost..url::Position::AfterPort],
                )
                .await;
        }
        if ![Method::GET, Method::HEAD].contains(input.method()) {
            return Err(Failure::new(ErrorCode::MethodNotAllowed, "Use GET or HEAD"));
        }
        if path == "/.well-known/matrix/client" {
            return registration::native(
                200,
                json!({"m.homeserver":{"base_url":self.configuration.public_origin.as_str().trim_end_matches('/')}}),
            );
        }
        let mut response = assets::serve(
            &self.element.directory,
            &routing::decode(&path)?,
            input.method() == Method::HEAD,
            self.stop.child_token(),
        )?;
        response.headers_mut().insert(
            "referrer-policy",
            hyper::header::HeaderValue::from_static("no-referrer"),
        );
        if ["/usercontent/", "/usercontent/index.html"].contains(&path.as_str()) {
            response.headers_mut().insert(
                header::CONTENT_SECURITY_POLICY,
                hyper::header::HeaderValue::from_static("frame-ancestors 'self'"),
            );
        } else {
            response.headers_mut().insert(
                "x-frame-options",
                hyper::header::HeaderValue::from_static("DENY"),
            );
        }
        Ok(response)
    }
}
impl<Access: WebRepositoryAccess, Messaging: MessagingAuthority, Operations: RoomOperations>
    MessagingHttp for WebServices<Access, Messaging, Operations>
{
    fn handle(
        &self,
        input: Request<Incoming>,
        peer: Peer,
        request_id: String,
    ) -> BackendResponse<'_> {
        Box::pin(async move { self.apply(input, peer, &request_id).await })
    }
}
