use crate::account::{API, Authority};
use crossfire_adapter_http::segment;
use crossfire_contracts::{matrix_event, validation};
use crossfire_domain::matrix::MatrixEvent;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use reqwest::Method;
use serde_json::{Value, json};

impl Authority {
    pub async fn event(&self, user: &str, room: &str, event_id: &str) -> Result<MatrixEvent> {
        validation::room_id(&json!(room))?;
        validation::event_id(&json!(event_id))?;
        let token = self.as_user(user).await?;
        let value = self
            .http
            .ok(
                Some(&token),
                Method::GET,
                &format!("{API}/rooms/{}/event/{}", segment(room), segment(event_id)),
                None,
            )
            .await?;
        matrix_event::event(&value, room, event_id)
    }

    pub async fn send_notice(
        &self,
        user: &str,
        room: &str,
        transaction_id: &str,
        body: &str,
        sender: &str,
    ) -> Result<String> {
        validation::room_id(&json!(room))?;
        validation::text(&json!(transaction_id), 1, 255)?;
        validation::matrix_user_id(&json!(sender))?;
        let token = self.as_user(user).await?;
        let response = self.http.request(Some(&token), Method::PUT,
            &format!("{API}/rooms/{}/send/m.room.message/{}", segment(room), segment(transaction_id)),
            Some(&json!({"msgtype":"m.notice","body":body,"m.mentions":{"user_ids":[sender]},matrix_event::LISTENER_NOTICE:true}))).await?;
        if response.status == 403 {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Native room rules do not permit this notice",
            ));
        }
        if response.status != 200 {
            return Err(Failure::new(
                ErrorCode::Native,
                "Notice publication remains unconfirmed",
            ));
        }
        validation::event_id(response.body.get("event_id").unwrap_or(&Value::Null))
            .map_err(|_| Failure::new(ErrorCode::Native, "Notice publication remains unconfirmed"))
    }
}
