use crate::account::{API, Authority, OperationKey, credentials};
use crossfire_contracts::origin::segment;
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use reqwest::Method;
use serde_json::{Value, json};
use std::time::Duration;

impl Authority {
    pub async fn set_display_name(&self, user: &str, display_name: &str) -> Result<()> {
        validation::text(&json!(display_name), 1, 255)?;
        let token = self.as_user(user).await?;
        self.http
            .ok(
                Some(&token),
                Method::PUT,
                &format!("{API}/profile/{}/displayname", segment(user)),
                Some(&json!({"displayname":display_name})),
            )
            .await?;
        Ok(())
    }

    async fn deactivated(&self, id: &str) -> Result<bool> {
        let response = self.http.request(None, Method::POST, &format!("{API}/login"),
            Some(&json!({"type":"m.login.password","identifier":{"type":"m.id.user","user":id},"password":"crossfire-deactivation-probe"}))).await?;
        match (
            response.status,
            response.body.get("errcode").and_then(Value::as_str),
        ) {
            (403, Some("M_USER_DEACTIVATED")) => Ok(true),
            (403, Some("M_FORBIDDEN")) => Ok(false),
            (200, _) => {
                let account = credentials(&response.body, id)?;
                self.http
                    .ok(
                        Some(&account.access_token),
                        Method::POST,
                        &format!("{API}/logout"),
                        Some(&json!({})),
                    )
                    .await?;
                Ok(false)
            }
            _ => Err(Failure::new(
                ErrorCode::Native,
                "Native account deactivation could not be verified",
            )),
        }
    }

    async fn remove_account(&self, id: &str) -> Result<()> {
        if crate::syntax::user_id(&json!(id)).is_err()
            || !id.ends_with(&format!(":{}", self.configuration.server_name))
            || id == self.configuration.service_backend_user_id
            || id == format!("@conduit:{}", self.configuration.server_name)
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Protected or invalid native account",
            ));
        }
        if self.deactivated(id).await? {
            return Ok(());
        }
        let admin = self
            .as_user(&self.configuration.service_backend_user_id)
            .await?;
        let room = self
            .http
            .ok(
                Some(&admin),
                Method::GET,
                &format!(
                    "{API}/directory/room/{}",
                    segment(&format!("#admins:{}", self.configuration.server_name))
                ),
                None,
            )
            .await?;
        let room =
            crate::syntax::room_id(room.get("room_id").unwrap_or(&Value::Null)).map_err(|_| {
                Failure::new(
                    ErrorCode::Native,
                    "Native administration room is unavailable",
                )
            })?;
        let transaction = identity::hash(&format!("deactivate:{id}"));
        self.http.ok(Some(&admin), Method::PUT, &format!("{API}/rooms/{}/send/m.room.message/{transaction}", segment(&room)),
            Some(&json!({"msgtype":"m.text","body":format!("@conduit:{}: deactivate-user --leave-rooms {id}", self.configuration.server_name)}))).await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let mut observations = tokio::time::interval(Duration::from_millis(200));
        observations.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                _ = self.cancellation.cancelled() => return Err(Failure::new(ErrorCode::Native, "Native authority stopped before deactivation was confirmed")),
                _ = tokio::time::sleep_until(deadline) => return Err(Failure::new(ErrorCode::Native, "Native account deactivation remains unconfirmed")),
                result = async { observations.tick().await; self.deactivated(id).await } => {
                    if result? {
                        self.cache.forget_session(id)?;
                        return Ok(());
                    }
                }
            }
        }
    }

    pub async fn deactivate(&self, id: &str) -> Result<()> {
        let _guard = self.exclusive(OperationKey::Account(id.to_owned())).await?;
        self.remove_account(id).await
    }

    pub async fn discard(&self, id: &str) -> Result<()> {
        let _guard = self.exclusive(OperationKey::Account(id.to_owned())).await?;
        if self.exists(id).await? {
            self.remove_account(id).await
        } else {
            Ok(())
        }
    }
}
