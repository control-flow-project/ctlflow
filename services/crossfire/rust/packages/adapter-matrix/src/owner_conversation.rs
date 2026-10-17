use crate::account::{API, Authority, OperationKey};
use crossfire_contracts::origin::segment;
use crossfire_contracts::{matrix_room, validation};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use reqwest::Method;
use serde_json::{Map, Value, json};

impl Authority {
    async fn direct_rooms(&self, token: &Secret, user: &str) -> Result<Map<String, Value>> {
        let response = self
            .http
            .request(
                Some(token),
                Method::GET,
                &format!("{API}/user/{}/account_data/m.direct", segment(user)),
                None,
            )
            .await?;
        if response.status == 404 {
            return Ok(Map::new());
        }
        let rooms = response
            .body
            .as_object()
            .filter(|rooms| response.status == 200 && rooms.len() <= 2000)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Native,
                    "Native direct-message account data is unavailable",
                )
            })?;
        for (identity, rooms) in rooms {
            validation::matrix_user_id(&json!(identity)).map_err(|_| {
                Failure::new(
                    ErrorCode::Native,
                    "Invalid native direct-message account data",
                )
            })?;
            let rooms = rooms
                .as_array()
                .filter(|rooms| rooms.len() <= 1000)
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Native,
                        "Invalid native direct-message account data",
                    )
                })?;
            for room in rooms {
                validation::room_id(room).map_err(|_| {
                    Failure::new(
                        ErrorCode::Native,
                        "Invalid native direct-message account data",
                    )
                })?;
            }
        }
        Ok(rooms.clone())
    }

    pub async fn mark_direct(&self, user: &str, counterpart: &str, room: &str) -> Result<()> {
        validation::matrix_user_id(&json!(counterpart))?;
        validation::room_id(&json!(room))?;
        let _guard = self
            .exclusive(OperationKey::AccountData(user.to_owned()))
            .await?;
        let token = self.as_user(user).await?;
        let mut rooms = self.direct_rooms(&token, user).await?;
        let mut selected = rooms
            .get(counterpart)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if selected.iter().any(|value| value.as_str() == Some(room)) {
            return Ok(());
        }
        selected.insert(0, json!(room));
        rooms.insert(counterpart.to_owned(), Value::Array(selected));
        self.http
            .ok(
                Some(&token),
                Method::PUT,
                &format!("{API}/user/{}/account_data/m.direct", segment(user)),
                Some(&Value::Object(rooms)),
            )
            .await?;
        Ok(())
    }

    pub async fn verify_owner_conversation(
        &self,
        owner: &str,
        agent: &str,
        room: &str,
    ) -> Result<()> {
        validation::matrix_user_id(&json!(owner))?;
        validation::matrix_user_id(&json!(agent))?;
        validation::room_id(&json!(room))?;
        if owner == agent {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid owner conversation identities",
            ));
        }
        matrix_room::owner_conversation(&self.state(owner, room).await?, owner, agent)
    }

    async fn conversation_name(&self, agent: &str) -> Result<String> {
        let name = self
            .profile_name(agent)
            .await?
            .filter(|name| !name.trim_matches(validation::whitespace).is_empty())
            .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native agent display name"))?;
        Ok(name)
    }

    pub async fn owner_conversation(
        &self,
        owner: &str,
        agent: &str,
        selected: Option<&str>,
        previous_name: Option<&str>,
    ) -> Result<String> {
        if validation::matrix_user_id(&json!(owner)).is_err()
            || validation::matrix_user_id(&json!(agent)).is_err()
            || owner == agent
            || !owner.ends_with(&format!(":{}", self.configuration.server_name))
            || !agent.ends_with(&format!(":{}", self.configuration.server_name))
            || selected.is_some_and(|room| validation::room_id(&json!(room)).is_err())
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid owner conversation identities",
            ));
        }
        let _guard = self
            .exclusive(OperationKey::OwnerConversation(owner.to_owned()))
            .await?;
        let owner_token = self.as_user(owner).await?;
        let agent_token = self.as_user(agent).await?;
        let mut selected = selected.map(str::to_owned);
        if selected.is_none() {
            let rooms = self.direct_rooms(&owner_token, owner).await?;
            for candidate in rooms
                .get(agent)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                match matrix_room::owner_conversation(
                    &self.state_with_token(&owner_token, candidate).await?,
                    owner,
                    agent,
                ) {
                    Ok(()) => {
                        selected = Some(candidate.to_owned());
                        break;
                    }
                    Err(error) if error.code == ErrorCode::Forbidden => {}
                    Err(error) => return Err(error),
                }
            }
        }
        if selected.is_none() {
            let pair = serde_json::to_string(&[owner, agent]).map_err(|_| {
                Failure::new(ErrorCode::Invalid, "Invalid owner conversation identities")
            })?;
            let local_alias = format!("crossfire-owner-{}", identity::hash(&pair));
            let alias_path = format!(
                "{API}/directory/room/{}",
                segment(&format!(
                    "#{local_alias}:{}",
                    self.configuration.server_name
                ))
            );
            let mut existing = self
                .http
                .request(Some(&owner_token), Method::GET, &alias_path, None)
                .await?;
            if existing.status == 404 {
                let name = self.conversation_name(agent).await?;
                let response = self.http.request(Some(&owner_token), Method::POST, &format!("{API}/createRoom"),
                    Some(&json!({"preset":"private_chat","visibility":"private","is_direct":true,"name":name,
                        "room_alias_name":local_alias,"invite":[agent],"power_level_content_override":{"invite":100}}))).await?;
                if response.status == 200 {
                    selected = Some(
                        validation::room_id(response.body.get("room_id").unwrap_or(&Value::Null))
                            .map_err(|_| {
                            Failure::new(
                                ErrorCode::Native,
                                "Native owner conversation creation was not confirmed",
                            )
                        })?,
                    );
                } else if response.status == 400
                    && response.body.get("errcode").and_then(Value::as_str) == Some("M_ROOM_IN_USE")
                {
                    existing = self
                        .http
                        .request(Some(&owner_token), Method::GET, &alias_path, None)
                        .await?;
                } else {
                    return Err(Failure::new(
                        ErrorCode::Native,
                        "Native owner conversation creation was not confirmed",
                    ));
                }
            }
            if selected.is_none() {
                if existing.status != 200 {
                    return Err(Failure::new(
                        ErrorCode::Native,
                        "Native owner conversation recovery was not confirmed",
                    ));
                }
                selected = Some(
                    validation::room_id(existing.body.get("room_id").unwrap_or(&Value::Null))
                        .map_err(|_| {
                            Failure::new(
                                ErrorCode::Native,
                                "Native owner conversation recovery was not confirmed",
                            )
                        })?,
                );
            }
        }
        let room = selected.ok_or_else(|| {
            Failure::new(
                ErrorCode::Native,
                "Native owner conversation recovery was not confirmed",
            )
        })?;
        let events = self.state_with_token(&owner_token, &room).await?;
        matrix_room::owner_conversation(&events, owner, agent)?;
        let title = events
            .iter()
            .find(|event| event.event_type == "m.room.name" && event.state_key.is_empty())
            .and_then(|event| event.content.get("name"));
        if title.is_some_and(|value| !value.is_string()) {
            return Err(Failure::new(
                ErrorCode::Native,
                "Invalid native conversation name",
            ));
        }
        if title.is_none_or(|value| {
            value.as_str().is_some_and(|title| {
                title.trim_matches(validation::whitespace).is_empty()
                    || Some(title) == previous_name
            })
        }) {
            let name = self.conversation_name(agent).await?;
            self.http
                .ok(
                    Some(&owner_token),
                    Method::PUT,
                    &format!("{API}/rooms/{}/state/m.room.name", segment(&room)),
                    Some(&json!({"name":name})),
                )
                .await?;
        }
        for (user, token) in [(owner, &owner_token), (agent, &agent_token)] {
            let membership = events
                .iter()
                .find(|event| event.event_type == "m.room.member" && event.state_key == user)
                .and_then(|event| event.content.get("membership"))
                .and_then(Value::as_str);
            let path = format!("{API}/rooms/{}", segment(&room));
            if membership == Some("ban") {
                self.http
                    .ok(
                        Some(&owner_token),
                        Method::POST,
                        &format!("{path}/unban"),
                        Some(&json!({"user_id":user})),
                    )
                    .await?;
            }
            if membership != Some("join") {
                if user == agent && membership != Some("invite") {
                    self.http
                        .ok(
                            Some(&owner_token),
                            Method::POST,
                            &format!("{path}/invite"),
                            Some(&json!({"user_id":agent})),
                        )
                        .await?;
                }
                self.http
                    .ok(
                        Some(token),
                        Method::POST,
                        &format!("{API}/join/{}", segment(&room)),
                        Some(&json!({})),
                    )
                    .await?;
            }
        }
        matrix_room::owner_conversation(
            &self.state_with_token(&owner_token, &room).await?,
            owner,
            agent,
        )?;
        self.mark_direct(owner, agent, &room).await?;
        self.mark_direct(agent, owner, &room).await?;
        Ok(room)
    }
}
