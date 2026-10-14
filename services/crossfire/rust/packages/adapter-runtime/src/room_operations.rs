use crossfire_domain::room_access::operations::RoomOperations;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use tokio_util::sync::CancellationToken;

struct Slot {
    operation: Arc<AsyncMutex<()>>,
    references: usize,
}
struct State {
    pending: Mutex<HashMap<String, Slot>>,
    cancellation: CancellationToken,
}
pub struct Operations(Arc<State>);
pub struct Guard {
    state: Arc<State>,
    key: String,
    slot: Weak<AsyncMutex<()>>,
    held: Option<OwnedMutexGuard<()>>,
}
impl Drop for Guard {
    fn drop(&mut self) {
        drop(self.held.take());
        if let Ok(mut pending) = self.state.pending.lock()
            && let Some(slot) = pending.get_mut(&self.key)
            && Arc::as_ptr(&slot.operation) == self.slot.as_ptr()
        {
            slot.references -= 1;
            if slot.references == 0 {
                pending.remove(&self.key);
            }
        }
    }
}
impl Default for Operations {
    fn default() -> Self {
        Self(Arc::new(State {
            pending: Mutex::new(HashMap::new()),
            cancellation: CancellationToken::new(),
        }))
    }
}
impl Operations {
    pub fn close(&self) {
        self.0.cancellation.cancel();
        if let Ok(mut pending) = self.0.pending.lock() {
            pending.clear();
        }
    }
}
impl Drop for Operations {
    fn drop(&mut self) {
        self.close();
    }
}
impl RoomOperations for Operations {
    type Guard = Guard;
    async fn acquire(&self, key: &str) -> Result<Self::Guard> {
        if self.0.cancellation.is_cancelled() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Room operations are stopped",
            ));
        }
        let operation = {
            let mut pending = self.0.pending.lock().map_err(|_| {
                Failure::new(ErrorCode::Unavailable, "Room operation ownership failed")
            })?;
            let slot = pending.entry(key.to_owned()).or_insert_with(|| Slot {
                operation: Arc::new(AsyncMutex::new(())),
                references: 0,
            });
            slot.references = slot.references.checked_add(1).ok_or_else(|| {
                Failure::new(
                    ErrorCode::Limit,
                    "Room operation count exceeds native range",
                )
            })?;
            Arc::clone(&slot.operation)
        };
        let mut reservation = Guard {
            state: Arc::clone(&self.0),
            key: key.to_owned(),
            slot: Arc::downgrade(&operation),
            held: None,
        };
        tokio::select! {
            biased; _ = self.0.cancellation.cancelled() => Err(Failure::new(ErrorCode::Unavailable,"Room operations are stopped")),
            guard = operation.lock_owned() => { reservation.held = Some(guard); Ok(reservation) },
        }
    }
}
