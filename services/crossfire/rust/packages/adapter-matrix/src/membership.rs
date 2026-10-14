use crate::account::{API, Authority};
use crossfire_adapter_http::segment;
use crossfire_contracts::{
    matrix_room::{self, StateEvent},
    validation,
};
use crossfire_domain::matrix::{
    AccessMode, Membership, RoomAccess, RoomAdmission, RoomInvitation, RoomMembership, RoomPower,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use reqwest::Method;
use serde_json::{Value, json};

pub(crate) struct MemberState {
    pub member: RoomMembership,
    pub read_level: i64,
    pub reply_level: i64,
}

pub(crate) fn member_state(events: &[StateEvent], target: &str) -> Result<MemberState> {
    let content = events
        .iter()
        .find(|event| event.event_type == "m.room.member" && event.state_key == target)
        .map(|event| &event.content);
    let membership = match content
        .and_then(|content| content.get("membership"))
        .filter(|value| !value.is_null())
        .and_then(Value::as_str)
        .unwrap_or("leave")
    {
        "join" => Membership::Join,
        "invite" => Membership::Invite,
        "leave" => Membership::Leave,
        "ban" => Membership::Ban,
        _ => {
            return Err(Failure::new(
                ErrorCode::Native,
                "Unsupported native membership",
            ));
        }
    };
    if content
        .and_then(|content| content.get("membership"))
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err(Failure::new(
            ErrorCode::Native,
            "Unsupported native membership",
        ));
    }
    let powers = events
        .iter()
        .find(|event| event.event_type == "m.room.power_levels" && event.state_key.is_empty())
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Native room power levels are missing"))?;
    let levels = matrix_room::powers(&powers.content, target)?;
    let creators = matrix_room::creators(events)?;
    let name = content.and_then(|content| content.get("displayname"));
    let display_name = name
        .and_then(|value| validation::text(value, 1, 255).ok())
        .unwrap_or(target)
        .to_owned();
    Ok(MemberState {
        member: RoomMembership {
            matrix_user_id: target.to_owned(),
            display_name,
            membership,
            power: if creators.iter().any(|id| id == target) {
                RoomPower::Creator
            } else {
                RoomPower::Level(levels.owner_level)
            },
        },
        read_level: levels
            .ceiling
            .min(levels.ordinary - 1)
            .min(levels.message - 1)
            .min(levels.reaction - 1),
        reply_level: levels.message.max(levels.reaction),
    })
}

impl Authority {
    pub async fn membership(&self, user: &str, target: &str, room: &str) -> Result<RoomMembership> {
        validation::matrix_user_id(&json!(target))?;
        Ok(member_state(&self.state(user, room).await?, target)?.member)
    }

    pub(crate) async fn invitation_event(
        &self,
        recipient: &str,
        room: &str,
        sender: &str,
    ) -> Result<Option<RoomInvitation>> {
        validation::room_id(&json!(room))?;
        validation::matrix_user_id(&json!(recipient))?;
        let token = self.as_user(sender).await?;
        let response = self
            .http
            .json(
                Some(&token),
                Method::GET,
                &format!("{API}/rooms/{}/state", segment(room)),
                None,
                crossfire_adapter_http::MAX_JSON_BYTES,
                std::time::Duration::from_secs(15),
            )
            .await?;
        let events = response
            .body
            .as_array()
            .filter(|events| response.status == 200 && events.len() <= 1000)
            .ok_or_else(|| {
                Failure::new(ErrorCode::Native, "Native invitation could not be verified")
            })?;
        if events.iter().any(|event| !event.is_object()) {
            return Err(Failure::new(
                ErrorCode::Native,
                "Invalid native membership event",
            ));
        }
        if let Some(event) = events.iter().find(|event| {
            event.get("type").and_then(Value::as_str) == Some("m.room.member")
                && event.get("state_key").and_then(Value::as_str) == Some(recipient)
        }) {
            let content = event
                .get("content")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Native, "Invalid native membership content")
                })?;
            if content.get("membership").and_then(Value::as_str) != Some("invite")
                || event.get("sender").and_then(Value::as_str) != Some(sender)
            {
                return Ok(None);
            }
            let event_id = validation::event_id(event.get("event_id").unwrap_or(&Value::Null))
                .map_err(|_| {
                    Failure::new(ErrorCode::Native, "Invalid native invitation identity")
                })?;
            if content
                .get("is_direct")
                .is_some_and(|value| !value.is_boolean())
            {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Invalid native direct invitation",
                ));
            }
            return Ok(Some(RoomInvitation {
                room_id: room.to_owned(),
                event_id,
                sender_matrix_id: sender.to_owned(),
                direct: content.get("is_direct") == Some(&Value::Bool(true)),
            }));
        }
        Ok(None)
    }

    async fn verify_invitation(
        &self,
        user: &str,
        target: &str,
        room: &str,
        current: &RoomMembership,
        admission: Option<&RoomAdmission>,
    ) -> Result<()> {
        let Some(RoomAdmission::Invitation {
            event_id,
            sender_matrix_id,
        }) = admission
        else {
            return Ok(());
        };
        if current.membership == Membership::Join {
            return Ok(());
        }
        if sender_matrix_id != user {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Native invitation authority does not match",
            ));
        }
        if self
            .invitation_event(target, room, user)
            .await?
            .is_some_and(|invitation| invitation.event_id == *event_id)
        {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Conflict,
                "Native invitation was withdrawn or replaced",
            ))
        }
    }

    pub async fn set_room_access(
        &self,
        user: &str,
        target: &str,
        room: &str,
        access: RoomAccess,
        admission: Option<&RoomAdmission>,
    ) -> Result<RoomMembership> {
        validation::matrix_user_id(&json!(target))?;
        validation::integer(
            &json!(access.power_level),
            -validation::SAFE_INTEGER,
            validation::SAFE_INTEGER,
        )?;
        let events = self.state(user, room).await?;
        if !events.iter().any(|event| {
            event.event_type == "m.room.member"
                && event.state_key == user
                && event.content.get("membership").and_then(Value::as_str) == Some("join")
        }) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Owner is not a current room member",
            ));
        }
        let authorizer = member_state(&events, user)?;
        let current = member_state(&events, target)?.member;
        if matches!(authorizer.member.power, RoomPower::Level(level) if access.power_level > level)
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Requested power exceeds native authority",
            ));
        }
        if current.power == RoomPower::Creator && access.mode != AccessMode::Reply {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Native creator authority cannot be restricted by an agent grant",
            ));
        }
        if current.power != RoomPower::Creator
            && access.mode == AccessMode::Reply
            && access.power_level < authorizer.reply_level
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Read-and-reply access requires native reply authority",
            ));
        }
        if admission.is_none() && current.membership != Membership::Join {
            return Ok(current);
        }
        self.verify_invitation(user, target, room, &current, admission)
            .await?;
        let token = self.as_user(user).await?;
        let path = format!("{API}/rooms/{}", segment(room));
        if matches!(current.power, RoomPower::Level(level) if level != access.power_level) {
            let mut powers = self
                .http
                .ok(
                    Some(&token),
                    Method::GET,
                    &format!("{path}/state/m.room.power_levels"),
                    None,
                )
                .await?;
            let mut users = powers
                .get("users")
                .filter(|value| !value.is_null())
                .map_or(Some(serde_json::Map::new()), |value| {
                    value.as_object().cloned()
                })
                .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native power levels"))?;
            users.insert(target.to_owned(), json!(access.power_level));
            powers["users"] = Value::Object(users);
            self.http
                .ok(
                    Some(&token),
                    Method::PUT,
                    &format!("{path}/state/m.room.power_levels"),
                    Some(&powers),
                )
                .await?;
        }
        if current.membership != Membership::Join {
            if admission == Some(&RoomAdmission::Managed) {
                self.invite(user, room, target).await?;
            } else {
                self.verify_invitation(user, target, room, &current, admission)
                    .await?;
            }
            let target_token = self.as_user(target).await?;
            self.http
                .ok(
                    Some(&target_token),
                    Method::POST,
                    &format!("{path}/join"),
                    Some(&json!({})),
                )
                .await?;
        }
        let checked = member_state(&self.state(user, room).await?, target)?;
        let permitted = match checked.member.power {
            RoomPower::Creator => access.mode == AccessMode::Reply,
            RoomPower::Level(level) => {
                level == access.power_level
                    && (access.mode != AccessMode::Reply || level >= checked.reply_level)
                    && (access.mode != AccessMode::Read || level <= checked.read_level)
            }
        };
        if checked.member.membership != Membership::Join || !permitted {
            return Err(Failure::new(
                ErrorCode::Native,
                "Native room membership and requested permissions were not confirmed",
            ));
        }
        Ok(checked.member)
    }
}
