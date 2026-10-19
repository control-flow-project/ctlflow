use crate::account::{API, Authority};
use crossfire_contracts::validation;
use crossfire_domain::messaging::{Account, BackendConfiguration, BackendDescription};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Map, Value, json};

impl Authority {
    pub fn describe(&self, public_origin: &str) -> BackendDescription {
        BackendDescription {
            backend_type: "matrix".to_owned(),
            label: "Matrix".to_owned(),
            chat_url: format!("{public_origin}/"),
            signup_url: format!("{public_origin}/#/register"),
            signup_instructions: vec![
                "Continue to Element and choose your username and password.".to_owned(),
                "Select “Start authentication” and confirm the invitation in the window it opens."
                    .to_owned(),
                "Return to Element to finish signing up.".to_owned(),
            ],
            configuration: BackendConfiguration {
                backend_type: "matrix".to_owned(),
                parameters: Map::from_iter([
                    ("origin".to_owned(), json!(public_origin)),
                    (
                        "serverName".to_owned(),
                        json!(self.configuration.server_name),
                    ),
                ]),
            },
        }
    }
    pub async fn authenticate(&self, username: &str, password: &Secret) -> Result<Secret> {
        let response = self.http.request(None, reqwest::Method::POST, &format!("{API}/login"), Some(&json!({"type":"m.login.password","identifier":{"type":"m.id.user","user":username},"password":password.expose(),"initial_device_display_name":"crossfire management"}))).await?;
        if response.status == 200
            && let Some(token) = response
                .body
                .get("access_token")
                .and_then(|value| validation::text(value, 1, 8192).ok())
        {
            return Ok(Secret::new(token.to_owned()));
        }
        Err(Failure::new(
            ErrorCode::Unauthorized,
            "Messaging account sign-in failed",
        ))
    }
    pub fn agent_account(&self, user: &str, access_token: Secret) -> Account {
        Account {
            user_id: user.to_owned(),
            access_token,
            native: Map::from_iter([("deviceId".to_owned(), json!("CROSSFIRE_AGENT"))]),
        }
    }
    pub fn agent_user_id(&self, id: &str) -> String {
        format!("@agent-{id}:{}", self.configuration.server_name)
    }
    pub fn service_user_id(&self) -> &str {
        &self.configuration.service_backend_user_id
    }
    pub fn local_label(&self, user: &str) -> Result<String> {
        crate::syntax::user_id(&json!(user))?;
        Ok(user[1..]
            .split_once(':')
            .map_or("", |(local, _)| local)
            .to_owned())
    }
    pub fn registration_user_id(
        &self,
        username: &str,
        password: &Secret,
        native: &Map<String, Value>,
    ) -> Result<String> {
        if username.is_empty()
            || username.len() > 100
            || !username.as_bytes()[0].is_ascii_lowercase()
                && !username.as_bytes()[0].is_ascii_digit()
            || !username.bytes().all(|value| {
                value.is_ascii_lowercase() || value.is_ascii_digit() || b"._=-".contains(&value)
            })
            || username.starts_with("agent-")
            || !(12..=1024).contains(&password.expose().encode_utf16().count())
            || native.keys().any(|key| key != "deviceId")
            || native
                .get("deviceId")
                .is_some_and(|value| validation::text(value, 1, 100).is_err())
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Choose a valid Matrix username and a password of at least 12 characters",
            ));
        }
        let user = format!("@{username}:{}", self.configuration.server_name);
        if user == self.configuration.service_backend_user_id || username == "conduit" {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Reserved Matrix identity",
            ));
        }
        Ok(user)
    }
}
