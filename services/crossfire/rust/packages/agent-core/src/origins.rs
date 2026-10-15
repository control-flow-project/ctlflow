use crate::{
    events::{Event, Kind, Origin, invalid},
    matrix::{self, API, Matrix, Request},
};
use crossfire_contracts::{operations::Method, origin::segment, validation as check};
use crossfire_kernel::{Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

pub async fn enrich(
    matrix: &impl Matrix,
    self_id: &str,
    mut events: Vec<Event>,
    stop: CancellationToken,
) -> Result<Vec<Event>> {
    check::matrix_user_id(&json!(self_id))?;
    let direct = matrix::request(
        matrix,
        &Request::new(
            Method::Get,
            format!("{API}/user/{}/account_data/m.direct", segment(self_id)),
        ),
        stop.clone(),
    )
    .await;
    let mut private = BTreeSet::new();
    match direct {
        Ok(Value::Object(direct)) => {
            for (user, rooms) in direct {
                check::matrix_user_id(&json!(user))?;
                for room in check::list(&rooms, 0, 1000)? {
                    private.insert(check::room_id(room)?);
                }
            }
        }
        Err(error) if error.code == ErrorCode::Missing => {}
        Err(error) => return Err(error),
        _ => return Err(invalid("Invalid native direct-message map")),
    }
    let mut origins = BTreeMap::new();
    for room in events
        .iter()
        .map(|value| &value.room_id)
        .collect::<BTreeSet<_>>()
    {
        let state = matrix::request(
            matrix,
            &Request::new(Method::Get, format!("{API}/rooms/{}/state", segment(room))),
            stop.clone(),
        )
        .await?;
        let state = check::list(&state, 0, 10000)?;
        let mut origin = Origin {
            kind: if private.contains(room) {
                Kind::Dm
            } else {
                Kind::Room
            },
            name: None,
            alias: None,
        };
        for event in state {
            let content = event
                .get("content")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("Invalid native room-state content"))?;
            let kind = event
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Missing native state type"))?;
            if event.get("state_key").and_then(Value::as_str) != Some("") {
                continue;
            }
            match kind {
                "m.room.name" => {
                    origin.name = content
                        .get("name")
                        .map(|value| check::plain_text(value, 16000).map(str::to_owned))
                        .transpose()?
                }
                "m.room.canonical_alias" => {
                    origin.alias = content
                        .get("alias")
                        .filter(|value| value.as_str() != Some(""))
                        .map(|value| check::text(value, 1, 4096).map(str::to_owned))
                        .transpose()?
                }
                _ => {}
            }
        }
        origins.insert(room.clone(), origin);
    }
    for event in &mut events {
        event.origin = origins
            .get(&event.room_id)
            .cloned()
            .ok_or_else(|| invalid("Missing verified event origin"))?;
    }
    Ok(events)
}
