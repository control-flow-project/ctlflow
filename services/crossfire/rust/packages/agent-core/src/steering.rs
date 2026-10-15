use crate::{
    coordination::{self, Coordination},
    events::{Event, Kind},
    matrix::{self, API, Matrix, Request},
    profile::Profile,
};
use crossfire_contracts::{matrix_event, operations::Method, origin::segment, validation as check};
use crossfire_kernel::Result;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tokio_util::sync::CancellationToken;

pub fn source(event: &Event) -> Result<crossfire_domain::matrix::MatrixEvent> {
    matrix_event::event(
        &json!({"event_id":event.event_id,"sender":event.sender,"type":event.kind,"content":event.content}),
        &event.room_id,
        &event.event_id,
    )
}
pub async fn authorized(
    matrix: &impl Matrix,
    coordination: &impl Coordination,
    profile: &Profile,
    event: &Event,
    senders: &BTreeSet<String>,
    stop: CancellationToken,
) -> Result<bool> {
    let source = source(event)?;
    if source.event_type != "m.room.message"
        || source.message_type.as_deref() != Some("m.text")
        || source.body.is_none()
        || source.edited
        || source.control
        || source.sender_matrix_id == profile.account.user_id
    {
        return Ok(false);
    }
    let mention = matrix_event::mentions_agent(&source, &profile.account.user_id);
    let pause = source.sender_matrix_id == profile.settings.owner
        && source
            .body
            .as_deref()
            .is_some_and(|body| body.trim() == "!!");
    let direct = event.origin.kind == Kind::Dm;
    if !pause && (!senders.contains(&event.sender) || !mention && !direct) {
        return Ok(false);
    }
    let identities =
        coordination::senders(coordination, std::slice::from_ref(event), stop.clone()).await?;
    if identities
        .get(&event.sender)
        .is_none_or(|identity| identity.kind.is_none())
    {
        return Ok(false);
    }
    let joined = matrix::request(
        matrix,
        &Request::new(
            Method::Get,
            format!("{API}/rooms/{}/joined_members", segment(&event.room_id)),
        ),
        stop,
    )
    .await?;
    let joined = joined
        .get("joined")
        .and_then(Value::as_object)
        .ok_or_else(|| crate::events::invalid("Invalid native joined-member response"))?;
    for member in joined.keys() {
        check::matrix_user_id(&json!(member))?;
    }
    Ok(joined.contains_key(&event.sender)
        && joined.contains_key(&profile.account.user_id)
        && (mention || (pause || direct) && joined.len() == 2))
}
