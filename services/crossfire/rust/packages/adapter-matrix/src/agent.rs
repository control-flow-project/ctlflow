use crate::protocol::{Protocol, Request, Response};
use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_contracts::operations::Method;
use crossfire_domain::{
    messaging::{Account, BackendConfiguration},
    messaging_client::{InvitationReader, MessagingConnector},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct HttpTransport {
    http: NativeHttp,
    credential: Secret,
    request_bytes: usize,
}
pub struct Client<T: Protocol = HttpTransport> {
    native: T,
    pub(crate) user: String,
    pub(crate) invitations: tokio::sync::Mutex<Option<crate::invitation::InvitationState>>,
}
impl Client<HttpTransport> {
    pub fn new(
        configuration: &BackendConfiguration,
        account: &Account,
        request_bytes: usize,
        stop: CancellationToken,
    ) -> Result<Self> {
        let parameters = &configuration.parameters;
        if configuration.backend_type != "matrix"
            || parameters.len() != 2
            || !parameters.contains_key("origin")
            || !parameters.contains_key("serverName")
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid Matrix client configuration",
            ));
        }
        let origin = crossfire_contracts::validation::text(&parameters["origin"], 1, 2048)?;
        crossfire_contracts::origin::parse(origin)?;
        crossfire_contracts::validation::text(&parameters["serverName"], 1, 255)?;
        crate::syntax::user_id(&serde_json::json!(account.user_id))?;
        Self::from_protocol(
            HttpTransport {
                http: NativeHttp::new(origin, stop)?,
                credential: account.access_token.clone(),
                request_bytes,
            },
            &account.user_id,
        )
    }
}
impl<T: Protocol> Client<T> {
    pub fn from_protocol(native: T, user: &str) -> Result<Self> {
        crate::syntax::user_id(&serde_json::json!(user))?;
        Ok(Self {
            native,
            user: user.to_owned(),
            invitations: tokio::sync::Mutex::new(None),
        })
    }
}
impl<T: Protocol> Protocol for Client<T> {
    async fn request(&self, request: &Request, stop: CancellationToken) -> Result<Response> {
        self.native.request(request, stop).await
    }
}
impl Protocol for HttpTransport {
    async fn request(&self, request: &Request, stop: CancellationToken) -> Result<Response> {
        if !request.path.starts_with("/_matrix/") || request.path.contains('?') {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Native agent requests must remain on the Matrix protocol surface",
            ));
        }
        let mut path = request.path.clone();
        if !request.query.is_empty() {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            for (key, value) in &request.query {
                query.append_pair(key, value);
            }
            path.push('?');
            path.push_str(&query.finish());
        }
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Patch => reqwest::Method::PATCH,
            Method::Delete => reqwest::Method::DELETE,
        };
        let response = tokio::select! { biased;
            _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Native, "Native agent request was cancelled")),
            result = self.http.json(Some(&self.credential), method, &path, request.body.as_ref(), JsonLimits { request_bytes: self.request_bytes, response_bytes: request.maximum_bytes, timeout: Duration::from_secs(45) }) => result?,
        };
        Ok(Response {
            status: response.status,
            body: response.body,
        })
    }
}

pub struct Connector;
impl MessagingConnector for Connector {
    type Client = Client;
    fn connect(
        &self,
        configuration: &BackendConfiguration,
        account: &Account,
        maximum_upload_bytes: usize,
        stop: CancellationToken,
    ) -> Result<Client> {
        Client::new(configuration, account, maximum_upload_bytes, stop)
    }
}

impl<T: Protocol> InvitationReader for Client<T> {
    async fn invitation_rooms(
        &self,
        stop: CancellationToken,
    ) -> Result<std::collections::BTreeSet<String>> {
        let mut state = tokio::select! { biased; _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Unavailable, "Invitation read cancelled")), state = self.invitations.lock() => state };
        let mut request = Request::new(Method::Get, crate::protocol::API.to_owned() + "/sync");
        request.maximum_bytes = 64 * 1024 * 1024;
        request.query.insert("timeout".to_owned(), "0".to_owned());
        request
            .query
            .insert("filter".to_owned(), crate::invitation::filter().to_string());
        if let Some(previous) = state.as_ref() {
            request
                .query
                .insert("since".to_owned(), previous.since.clone());
        }
        let response = crate::protocol::request(self, &request, stop).await?;
        let next = crate::invitation::apply(&response, &self.user, state.as_ref())?;
        let rooms = next.senders.keys().cloned().collect();
        *state = Some(next);
        Ok(rooms)
    }
}
