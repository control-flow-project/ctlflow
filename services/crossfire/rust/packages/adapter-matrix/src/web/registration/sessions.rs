use crossfire_contracts::validation as check;
use crossfire_domain::member::signup::Claim;
pub(super) struct Details {
    pub username: String,
    pub password: Secret,
    pub display_name: String,
    pub device_id: String,
}
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
};

#[derive(Default)]
pub struct Registration(Mutex<State>);
#[derive(Default)]
struct State {
    sessions: BTreeMap<String, Session>,
    pending: BTreeSet<String>,
}
pub(super) struct Confirmation {
    invitation: Option<Claim>,
    nonce: Secret,
}
pub(super) struct Session {
    pub expires_at: i64,
    pub authorized: bool,
    pub invitation: Option<Claim>,
    pub details: Option<Details>,
    confirmation: Option<Confirmation>,
}
impl Clone for Session {
    fn clone(&self) -> Self {
        Self {
            expires_at: self.expires_at,
            authorized: self.authorized,
            invitation: copy_claim(&self.invitation),
            details: self.details.as_ref().map(|details| Details {
                username: details.username.clone(),
                password: details.password.clone(),
                display_name: details.display_name.clone(),
                device_id: details.device_id.clone(),
            }),
            confirmation: self.confirmation.as_ref().map(|value| Confirmation {
                invitation: copy_claim(&value.invitation),
                nonce: value.nonce.clone(),
            }),
        }
    }
}
fn copy_claim(value: &Option<Claim>) -> Option<Claim> {
    value.as_ref().map(|value| Claim {
        id: value.id.clone(),
        secret: value.secret.clone(),
    })
}
fn same_claim(first: &Option<Claim>, second: &Option<Claim>) -> bool {
    match (first, second) {
        (None, None) => true,
        (Some(first), Some(second)) => first.id == second.id && first.secret == second.secret,
        _ => false,
    }
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub struct Pending<'a> {
    registration: &'a Registration,
    username: String,
}
impl Drop for Pending<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.registration.0.lock() {
            state.pending.remove(&self.username);
        }
    }
}
impl Registration {
    fn with<T>(&self, action: impl FnOnce(&mut State) -> Result<T>) -> Result<T> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Signup session ownership failed"))?;
        action(&mut state)
    }
    fn expire(state: &mut State, now: i64) {
        state.sessions.retain(|_, value| value.expires_at > now);
    }
    pub(super) fn prepare(&self, body: &Value, now: i64) -> Result<(String, Session)> {
        self.with(|state| {
            Self::expire(state, now);
            let auth = body.get("auth");
            let supplied = auth.and_then(|auth| auth.get("session"));
            let id = match supplied {
                Some(value) => value
                    .as_str()
                    .filter(|id| state.sessions.contains_key(*id))
                    .ok_or_else(|| {
                        invalid("Signup session is invalid or expired; restart registration")
                    })?
                    .to_owned(),
                None => {
                    if state.sessions.len() >= 1000 {
                        return Err(Failure::new(
                            ErrorCode::RateLimit,
                            "Too many signup attempts",
                        ));
                    }
                    let id = identity::id();
                    let expires_at = now
                        .checked_add(600000)
                        .ok_or_else(|| invalid("Signup clock exceeds its range"))?;
                    state.sessions.insert(
                        id.clone(),
                        Session {
                            expires_at,
                            authorized: false,
                            invitation: None,
                            details: None,
                            confirmation: None,
                        },
                    );
                    id
                }
            };
            let session = state
                .sessions
                .get_mut(&id)
                .ok_or_else(|| invalid("Signup session is invalid"))?;
            if body.get("username").is_some()
                || body.get("password").is_some()
                || body.get("device_id").is_some()
            {
                let username = check::text(&body["username"], 1, 100)?;
                if !username
                    .bytes()
                    .next()
                    .is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
                    || !username.bytes().all(|value| {
                        value.is_ascii_lowercase()
                            || value.is_ascii_digit()
                            || b"._=-".contains(&value)
                    })
                {
                    return Err(invalid(
                        "Choose a valid username and a password of at least 12 characters",
                    ));
                }
                let password = Secret::new(check::text(&body["password"], 12, 1024)?.to_owned());
                let device_id = body
                    .get("device_id")
                    .map(|value| check::text(value, 1, 100).map(str::to_owned))
                    .transpose()?
                    .unwrap_or_else(|| {
                        session
                            .details
                            .as_ref()
                            .map_or_else(identity::id, |value| value.device_id.clone())
                    });
                if session.details.as_ref().is_some_and(|value| {
                    value.username != username
                        || value.password != password
                        || value.device_id != device_id
                }) {
                    return Err(invalid("Account details changed; restart registration"));
                }
                session.details = Some(Details {
                    username: username.to_owned(),
                    display_name: username.to_owned(),
                    password,
                    device_id,
                });
            }
            if let Some(kind) = auth.and_then(|auth| auth.get("type"))
                && kind.as_str() != Some(super::STAGE)
            {
                return Err(invalid("Unsupported authentication stage"));
            }
            Ok((id, session.clone()))
        })
    }
    pub(super) fn session(&self, id: &str, now: i64) -> Result<Option<Session>> {
        self.with(|state| {
            Self::expire(state, now);
            Ok(state.sessions.get(id).cloned())
        })
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        self.with(|state| {
            state.sessions.remove(id);
            Ok(())
        })
    }
    pub(super) fn confirm(
        &self,
        id: &str,
        claim: &Option<Claim>,
        nonce: &Secret,
        now: i64,
    ) -> Result<()> {
        self.with(|state| {
            Self::expire(state, now);
            let session = state
                .sessions
                .get_mut(id)
                .ok_or_else(|| invalid("Signup expired. Return to Element and restart signup."))?;
            session.confirmation = Some(Confirmation {
                invitation: copy_claim(claim),
                nonce: nonce.clone(),
            });
            Ok(())
        })
    }
    pub(super) fn authorize(
        &self,
        id: &str,
        claim: &Option<Claim>,
        nonce: Option<&str>,
        now: i64,
    ) -> Result<bool> {
        self.with(|state| {
            Self::expire(state, now);
            let Some(session) = state.sessions.get_mut(id) else {
                return Ok(false);
            };
            if session.confirmation.as_ref().is_none_or(|value| {
                nonce.is_none_or(|nonce| value.nonce != Secret::new(nonce.to_owned()))
                    || !same_claim(&value.invitation, claim)
            }) {
                return Ok(false);
            }
            session.authorized = true;
            session.invitation = copy_claim(claim);
            session.confirmation = None;
            Ok(true)
        })
    }
    pub fn acquire(&self, username: &str) -> Result<Pending<'_>> {
        self.with(|state| {
            if !state.pending.insert(username.to_owned()) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "This username is being registered",
                ));
            }
            Ok(Pending {
                registration: self,
                username: username.to_owned(),
            })
        })
    }
}
