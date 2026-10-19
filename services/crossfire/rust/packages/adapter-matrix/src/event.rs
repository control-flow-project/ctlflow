use crate::account::{API, Authority};
use crossfire_contracts::origin::segment;
use crossfire_contracts::validation;
use crossfire_domain::messaging::BackendEvent;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use reqwest::Method;
use serde_json::{Value, json};

impl Authority {
    pub async fn event(&self, user: &str, room: &str, event_id: &str) -> Result<BackendEvent> {
        crate::syntax::room_id(&json!(room))?;
        crate::syntax::event_id(&json!(event_id))?;
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
        let event = crate::message_events::parse(&value, room)?;
        if event.event_id != event_id {
            return Err(Failure::new(
                ErrorCode::Native,
                "Matrix event identity changed",
            ));
        }
        Ok(BackendEvent {
            event_id: event.event_id,
            room_id: event.room_id,
            sender_backend_user_id: event.sender,
            event_type: event.event_type.code().to_owned(),
            message_type: Some(event.content.kind.code().to_owned()),
            body: event.content.body,
            mentions: event.content.mentions,
            edited: event.content.edited,
            control: event.content.control,
        })
    }

    pub async fn send_notice(
        &self,
        user: &str,
        room: &str,
        transaction_id: &str,
        body: &str,
        sender: &str,
    ) -> Result<String> {
        crate::syntax::room_id(&json!(room))?;
        validation::text(&json!(transaction_id), 1, 255)?;
        crate::syntax::user_id(&json!(sender))?;
        let token = self.as_user(user).await?;
        let response = self.http.request(Some(&token), Method::PUT,
            &format!("{API}/rooms/{}/send/m.room.message/{}", segment(room), segment(transaction_id)),
            Some(&json!({"msgtype":"m.notice","body":body,"m.mentions":{"user_ids":[sender]},crate::message_events::NOTICE_MARKER:true}))).await?;
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
        crate::syntax::event_id(response.body.get("event_id").unwrap_or(&Value::Null))
            .map_err(|_| Failure::new(ErrorCode::Native, "Notice publication remains unconfirmed"))
    }
}
