use crate::account::{API, Authority};
use crate::room_state::{self, StateEvent};
use crossfire_adapter_http::JsonLimits;
use crossfire_contracts::origin::segment;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use reqwest::Method;
use serde_json::{Value, json};

impl Authority {
    pub async fn state(&self, user: &str, room: &str) -> Result<Vec<StateEvent>> {
        crate::syntax::room_id(&json!(room))?;
        let token = self.as_user(user).await?;
        self.state_with_token(&token, room).await
    }

    pub(crate) async fn state_with_token(
        &self,
        token: &Secret,
        room: &str,
    ) -> Result<Vec<StateEvent>> {
        crate::syntax::room_id(&json!(room))?;
        let response = self
            .http
            .json(
                Some(token),
                Method::GET,
                &format!("{API}/rooms/{}/state", segment(room)),
                None,
                JsonLimits::default(),
            )
            .await?;
        if response.status != 200 {
            return Err(Failure::new(
                ErrorCode::Native,
                "Native room state could not be read",
            ));
        }
        room_state::state(&response.body)
    }

    pub async fn joined(&self, user: &str) -> Result<Vec<String>> {
        let token = self.as_user(user).await?;
        let value = self
            .http
            .ok(
                Some(&token),
                Method::GET,
                &format!("{API}/joined_rooms"),
                None,
            )
            .await?;
        let rooms = value
            .get("joined_rooms")
            .and_then(Value::as_array)
            .filter(|rooms| rooms.len() <= 1000)
            .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native joined-room list"))?;
        rooms
            .iter()
            .map(|room| {
                crate::syntax::room_id(room)
                    .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native joined-room list"))
            })
            .collect()
    }

    pub async fn leave(&self, user: &str, room: &str) -> Result<()> {
        crate::syntax::room_id(&json!(room))?;
        let token = self.as_user(user).await?;
        self.http
            .ok(
                Some(&token),
                Method::POST,
                &format!("{API}/rooms/{}/leave", segment(room)),
                Some(&json!({})),
            )
            .await?;
        Ok(())
    }

    pub async fn invite(&self, user: &str, room: &str, target: &str) -> Result<()> {
        crate::syntax::room_id(&json!(room))?;
        crate::syntax::user_id(&json!(target))?;
        let token = self.as_user(user).await?;
        self.http
            .ok(
                Some(&token),
                Method::POST,
                &format!("{API}/rooms/{}/invite", segment(room)),
                Some(&json!({"user_id":target})),
            )
            .await?;
        Ok(())
    }
}
