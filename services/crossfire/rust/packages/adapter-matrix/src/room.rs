use crate::account::{API, Authority};
use crossfire_adapter_http::{MAX_JSON_BYTES, segment};
use crossfire_contracts::{
    matrix_room::{self, StateEvent},
    validation,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use reqwest::Method;
use serde_json::{Value, json};
use std::time::Duration;

impl Authority {
    pub async fn state(&self, user: &str, room: &str) -> Result<Vec<StateEvent>> {
        validation::room_id(&json!(room))?;
        let token = self.as_user(user).await?;
        self.state_with_token(&token, room).await
    }

    pub(crate) async fn state_with_token(
        &self,
        token: &Secret,
        room: &str,
    ) -> Result<Vec<StateEvent>> {
        validation::room_id(&json!(room))?;
        let response = self
            .http
            .json(
                Some(token),
                Method::GET,
                &format!("{API}/rooms/{}/state", segment(room)),
                None,
                MAX_JSON_BYTES,
                Duration::from_secs(15),
            )
            .await?;
        if response.status != 200 {
            return Err(Failure::new(
                ErrorCode::Native,
                "Native room state could not be read",
            ));
        }
        matrix_room::state(&response.body)
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
                validation::room_id(room)
                    .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native joined-room list"))
            })
            .collect()
    }

    pub async fn leave(&self, user: &str, room: &str) -> Result<()> {
        validation::room_id(&json!(room))?;
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
        validation::room_id(&json!(room))?;
        validation::matrix_user_id(&json!(target))?;
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
