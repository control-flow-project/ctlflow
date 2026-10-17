use crate::{account::OperationKey, invitation::InvitationState};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

#[derive(Default)]
struct State {
    closed: bool,
    sessions: HashMap<String, Secret>,
    invitations: HashMap<String, InvitationState>,
    operations: HashMap<OperationKey, Weak<tokio::sync::Mutex<()>>>,
}

#[derive(Default)]
pub(crate) struct Cache {
    state: Mutex<State>,
}

impl Cache {
    fn active<T>(&self, action: impl FnOnce(&mut State) -> T) -> Result<T> {
        let mut state = self.state.lock().map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Native authority cache is unavailable",
            )
        })?;
        if state.closed {
            return Err(Failure::new(ErrorCode::Native, "Native authority stopped"));
        }
        Ok(action(&mut state))
    }

    pub fn close(&self) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(error) => error.into_inner(),
        };
        state.closed = true;
        state.sessions.clear();
        state.invitations.clear();
        state.operations.clear();
    }

    pub fn session(&self, id: &str) -> Result<Option<Secret>> {
        self.active(|state| state.sessions.get(id).cloned())
    }
    pub fn ensure_active(&self) -> Result<()> {
        self.active(|_| ())
    }
    pub fn remember_session(&self, id: &str, token: &Secret) -> Result<()> {
        self.active(|state| {
            state.sessions.insert(id.to_owned(), token.clone());
        })
    }
    pub fn forget_session(&self, id: &str) -> Result<()> {
        self.active(|state| {
            state.sessions.remove(id);
        })
    }
    pub fn invitations(&self, id: &str) -> Result<Option<InvitationState>> {
        self.active(|state| state.invitations.get(id).cloned())
    }
    pub fn remember_invitations(&self, id: &str, value: InvitationState) -> Result<()> {
        self.active(|state| {
            state.invitations.insert(id.to_owned(), value);
        })
    }
    pub fn operation(&self, key: OperationKey) -> Result<Arc<tokio::sync::Mutex<()>>> {
        self.active(|state| {
            state.operations.retain(|_, value| value.strong_count() > 0);
            if let Some(operation) = state.operations.get(&key).and_then(Weak::upgrade) {
                return operation;
            }
            let operation = Arc::new(tokio::sync::Mutex::new(()));
            state.operations.insert(key, Arc::downgrade(&operation));
            operation
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_erases_owned_tokens_and_refuses_late_cache_writes() -> Result<()> {
        let cache = Cache::default();
        let token = Secret::new("private-token".to_owned());
        cache.remember_session("owner", &token)?;
        assert!(cache.session("owner")?.is_some());
        cache.close();
        assert!(cache.session("owner").is_err());
        assert!(cache.remember_session("owner", &token).is_err());
        let state = cache
            .state
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Test cache unavailable"))?;
        assert!(state.sessions.is_empty());
        assert!(state.invitations.is_empty());
        assert!(state.operations.is_empty());
        Ok(())
    }
}
