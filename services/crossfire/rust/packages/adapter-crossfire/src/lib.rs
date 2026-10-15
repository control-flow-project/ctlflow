use crossfire_adapter_http::operation::Client;
pub mod agent_software;
pub mod fleet_connection;
pub mod fleet_snapshot;
pub mod listener_host;
use crossfire_agent_core::{coordination::Coordination, profile::Profile};
use crossfire_contracts::{call::Call, origin};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

pub struct Connection {
    origin: String,
    client: Client,
}
impl Connection {
    pub fn new(origin: &str, credential: Option<Secret>, stop: CancellationToken) -> Result<Self> {
        let canonical = origin::parse(origin)?.origin().ascii_serialization();
        Ok(Self {
            client: Client::new(&canonical, credential, stop)?,
            origin: canonical,
        })
    }
    pub fn agent(profile: &Profile, stop: CancellationToken) -> Result<Self> {
        Self::new(
            &profile.settings.homeserver,
            Some(profile.account.access_token.clone()),
            stop,
        )
    }
}
impl Coordination for Connection {
    fn origin(&self) -> &str {
        &self.origin
    }
    async fn call(&self, request: &Call, stop: CancellationToken) -> Result<Value> {
        let response = self.client.call(request, stop).await?;
        if request.definition()?.collection {
            let metadata = serde_json::to_value(response.metadata).map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Collection metadata cannot be encoded",
                )
            })?;
            Ok(serde_json::json!({"items":response.data,"meta":metadata}))
        } else {
            Ok(response.data)
        }
    }
}
