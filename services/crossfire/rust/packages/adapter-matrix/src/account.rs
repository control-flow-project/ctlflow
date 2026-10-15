use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use crossfire_adapter_http::NativeHttp;
use crossfire_contracts::origin::segment;
use crossfire_contracts::validation;
use crossfire_domain::matrix::Account;
use crossfire_domain::port::MatrixIdentity;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use hmac::{Hmac, Mac};
use reqwest::Method;
use serde_json::{Value, json};
use sha2::Sha256;
use tokio::sync::OwnedMutexGuard;
use tokio_util::sync::CancellationToken;

pub const API: &str = "/_matrix/client/v3";

pub struct Configuration {
    pub origin: String,
    pub server_name: String,
    pub jwt_secret: Secret,
    pub registration_secret: Secret,
    pub service_matrix_id: String,
}

pub struct Authority {
    pub(crate) http: NativeHttp,
    pub(crate) configuration: Configuration,
    pub(crate) cancellation: CancellationToken,
    pub(crate) cache: crate::cache::Cache,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum OperationKey {
    Account(String),
    OwnerConversation(String),
    AccountData(String),
    Invitations(String),
}

impl Authority {
    pub fn new(configuration: Configuration) -> Result<Self> {
        let cancellation = CancellationToken::new();
        let http = NativeHttp::new(&configuration.origin, cancellation.clone())?;
        Ok(Self {
            http,
            configuration,
            cancellation,
            cache: crate::cache::Cache::default(),
        })
    }

    pub fn close(&self) {
        self.cache.close();
        self.cancellation.cancel();
    }

    pub(crate) async fn exclusive(&self, key: OperationKey) -> Result<OwnedMutexGuard<()>> {
        let operation = self.cache.operation(key)?;
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(Failure::new(ErrorCode::Native, "Native authority stopped")),
            guard = operation.lock_owned() => Ok(guard),
        }
    }

    pub async fn as_user(&self, id: &str) -> Result<Secret> {
        if validation::matrix_user_id(&json!(id)).is_err()
            || !id.ends_with(&format!(":{}", self.configuration.server_name))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid local control identity",
            ));
        }
        let _guard = self.exclusive(OperationKey::Account(id.to_owned())).await?;
        let cached = self.cache.session(id)?;
        if let Some(token) = cached {
            let checked = self
                .http
                .request(
                    Some(&token),
                    Method::GET,
                    &format!("{API}/account/whoami"),
                    None,
                )
                .await?;
            if checked.status == 200
                && checked.body.get("user_id").and_then(Value::as_str) == Some(id)
            {
                self.cache.ensure_active()?;
                return Ok(token);
            }
            if checked.status != 401 {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Native control identity could not be verified",
                ));
            }
            self.cache.forget_session(id)?;
        }
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({"sub":id,"exp":identity::now()? / 1000 + 60}))
                .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native token"))?,
        );
        let unsigned = format!("{header}.{payload}");
        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.configuration.jwt_secret.expose().as_bytes())
                .map_err(|_| Failure::new(ErrorCode::Unavailable, "Invalid native signing key"))?;
        mac.update(unsigned.as_bytes());
        let token = format!(
            "{unsigned}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        );
        let body = self.http.ok(None, Method::POST, &format!("{API}/login"), Some(&json!({"type":"m.login.token","token":token,"device_id":"CROSSFIRE_MANAGEMENT","initial_device_display_name":"Crossfire management"}))).await?;
        let account = credentials(&body, id)?;
        self.cache.remember_session(id, &account.access_token)?;
        Ok(account.access_token)
    }

    pub async fn profile_name(&self, id: &str) -> Result<Option<String>> {
        validation::matrix_user_id(&json!(id))
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid native profile identity"))?;
        let body = self
            .http
            .ok(
                None,
                Method::GET,
                &format!("{API}/profile/{}/displayname", segment(id)),
                None,
            )
            .await?;
        match body.get("displayname") {
            None | Some(Value::Null) => Ok(None),
            Some(value) => validation::text(value, 1, 255)
                .map(|value| Some(value.to_owned()))
                .map_err(|_| {
                    Failure::new(ErrorCode::Native, "Invalid native profile display name")
                }),
        }
    }

    pub async fn provision(&self, id: &str, password: &Secret, device: &str) -> Result<Account> {
        if validation::matrix_user_id(&json!(id)).is_err()
            || !id.ends_with(&format!(":{}", self.configuration.server_name))
            || validation::text(&json!(password.expose()), 1, 1024).is_err()
            || validation::text(&json!(device), 1, 100).is_err()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid native account provisioning input",
            ));
        }
        let _guard = self.exclusive(OperationKey::Account(id.to_owned())).await?;
        let username = id[1..].split_once(':').map_or("", |(username, _)| username);
        let mut input = json!({"username":username,"password":password.expose(),"device_id":device,"inhibit_login":false});
        let mut response = self
            .http
            .request(None, Method::POST, &format!("{API}/register"), Some(&input))
            .await?;
        for _attempt in 0..4 {
            if response.status != 401 {
                break;
            }
            let challenge = &response.body;
            let session = challenge.get("session").ok_or_else(|| {
                Failure::new(ErrorCode::Native, "Invalid native registration challenge")
            })?;
            validation::text(session, 1, 255).map_err(|_| {
                Failure::new(ErrorCode::Native, "Invalid native registration challenge")
            })?;
            let flows = challenge
                .get("flows")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Native, "Invalid native registration challenge")
                })?;
            let completed = challenge.get("completed").and_then(Value::as_array);
            let stage = flows
                .iter()
                .flat_map(|flow| {
                    flow.get("stages")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                })
                .find(|stage| completed.is_none_or(|completed| !completed.contains(stage)))
                .and_then(Value::as_str);
            if !matches!(stage, Some("m.login.registration_token" | "m.login.dummy")) {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Unsupported native registration challenge",
                ));
            }
            let mut auth = json!({"type":stage,"session":session});
            if stage == Some("m.login.registration_token") {
                auth["token"] = json!(self.configuration.registration_secret.expose());
            }
            input["auth"] = auth;
            response = self
                .http
                .request(None, Method::POST, &format!("{API}/register"), Some(&input))
                .await?;
        }
        if response.status == 400
            && response.body.get("errcode").and_then(Value::as_str) == Some("M_USER_IN_USE")
        {
            response = self.http.request(None, Method::POST, &format!("{API}/login"), Some(&json!({"type":"m.login.password","identifier":{"type":"m.id.user","user":id},"password":password.expose(),"device_id":device}))).await?;
        }
        if response.status != 200 {
            return Err(Failure::new(
                ErrorCode::Native,
                "Account provisioning is not complete",
            ));
        }
        credentials(&response.body, id)
    }

    pub async fn exists(&self, id: &str) -> Result<bool> {
        if validation::matrix_user_id(&json!(id)).is_err()
            || !id.ends_with(&format!(":{}", self.configuration.server_name))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid local control identity",
            ));
        }
        let username = id
            .strip_prefix('@')
            .and_then(|value| value.split_once(':'))
            .map_or("", |(username, _)| username);
        let response = self
            .http
            .request(
                None,
                Method::GET,
                &format!("{API}/register/available?username={}", segment(username)),
                None,
            )
            .await?;
        if response.status == 200 && response.body.get("available") == Some(&Value::Bool(true)) {
            return Ok(false);
        }
        if response.status == 400
            && response.body.get("errcode").and_then(Value::as_str) == Some("M_USER_IN_USE")
        {
            return Ok(true);
        }
        Err(Failure::new(
            ErrorCode::Native,
            "Native account existence could not be verified",
        ))
    }
}

impl MatrixIdentity for Authority {
    async fn identify(&self, token: &Secret) -> Result<String> {
        let response = self
            .http
            .request(
                Some(token),
                Method::GET,
                &format!("{API}/account/whoami"),
                None,
            )
            .await?;
        let Some(id) = response.body.get("user_id") else {
            return Err(Failure::new(
                ErrorCode::Unauthorized,
                "Invalid native identity",
            ));
        };
        let id = validation::matrix_user_id(id)
            .map_err(|_| Failure::new(ErrorCode::Unauthorized, "Invalid native identity"))?;
        if response.status != 200 || !id.ends_with(&format!(":{}", self.configuration.server_name))
        {
            return Err(Failure::new(
                ErrorCode::Unauthorized,
                "Invalid native identity",
            ));
        }
        Ok(id.to_owned())
    }
}

pub(crate) fn credentials(body: &Value, expected: &str) -> Result<Account> {
    let user = body.get("user_id").and_then(Value::as_str);
    let token = body.get("access_token").and_then(Value::as_str);
    let device = body.get("device_id").and_then(Value::as_str);
    match (user, token, device) {
        (Some(user), Some(token), Some(device))
            if user == expected
                && validation::text(&json!(token), 1, 8192).is_ok()
                && validation::text(&json!(device), 1, 255).is_ok() =>
        {
            Ok(Account {
                user_id: user.to_owned(),
                access_token: Secret::new(token.to_owned()),
                device_id: device.to_owned(),
            })
        }
        _ => Err(Failure::new(
            ErrorCode::Native,
            "Unexpected native account credentials",
        )),
    }
}
