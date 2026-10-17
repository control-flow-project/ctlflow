use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct State {
    publication: bool,
    pending: bool,
    query: Option<(CancellationToken, bool)>,
}
#[derive(Default, Clone)]
pub struct Gate(Arc<Mutex<State>>);
pub struct Query {
    gate: Gate,
    stop: CancellationToken,
}
pub struct Publication {
    gate: Gate,
}
fn conflict() -> Failure {
    Failure::new(
        ErrorCode::Conflict,
        "Settle the current native publication or unread query before changing delivery positions",
    )
}
impl Gate {
    pub fn with_query_state(
        &self,
        exclusive: bool,
        operation: impl FnOnce() -> Result<bool>,
    ) -> Result<Option<bool>> {
        let state = self.0.lock().map_err(|_| conflict())?;
        if state.query.is_some() || exclusive && state.publication {
            return Ok(None);
        }
        let outcome = operation();
        drop(state);
        outcome.map(Some)
    }

    pub fn query(&self, stop: CancellationToken, exclusive: bool) -> Result<Query> {
        self.begin_query(stop, exclusive, false)
    }
    pub fn acknowledgment(&self, stop: CancellationToken) -> Result<Query> {
        self.begin_query(stop, true, true)
    }
    fn begin_query(
        &self,
        stop: CancellationToken,
        exclusive: bool,
        acknowledging: bool,
    ) -> Result<Query> {
        let mut state = self.0.lock().map_err(|_| conflict())?;
        if exclusive && (state.publication || state.pending && !acknowledging)
            || state.query.is_some()
        {
            return Err(conflict());
        }
        let stop = stop.child_token();
        state.query = Some((stop.clone(), exclusive));
        Ok(Query {
            gate: self.clone(),
            stop,
        })
    }
    pub fn publication(&self) -> Result<Publication> {
        let mut state = self.0.lock().map_err(|_| conflict())?;
        if state.publication
            || state
                .query
                .as_ref()
                .is_some_and(|(_, exclusive)| *exclusive)
        {
            return Err(conflict());
        }
        state.publication = true;
        Ok(Publication { gate: self.clone() })
    }
    pub fn interrupt_query(&self) -> Result<()> {
        let state = self.0.lock().map_err(|_| conflict())?;
        if let Some((query, _)) = &state.query {
            query.cancel();
        }
        Ok(())
    }
    pub fn pending(&self, pending: bool) -> Result<()> {
        let mut state = self.0.lock().map_err(|_| conflict())?;
        if pending
            && state
                .query
                .as_ref()
                .is_some_and(|(stop, exclusive)| *exclusive && !stop.is_cancelled())
        {
            return Err(conflict());
        }
        state.pending = pending;
        Ok(())
    }
    pub fn publishing(&self) -> Result<bool> {
        let state = self.0.lock().map_err(|_| conflict())?;
        Ok(state.publication || state.pending)
    }
}
impl Query {
    pub fn cancellation(&self) -> CancellationToken {
        self.stop.clone()
    }
    pub fn check(&self) -> Result<()> {
        if self.stop.is_cancelled() {
            Err(Failure::new(
                ErrorCode::Unavailable,
                "Unread query cancelled; delivery positions are unchanged",
            ))
        } else {
            Ok(())
        }
    }
}
impl Drop for Query {
    fn drop(&mut self) {
        self.stop.cancel();
        if let Ok(mut state) = self.gate.0.lock() {
            state.query = None;
        }
    }
}
impl Drop for Publication {
    fn drop(&mut self) {
        if let Ok(mut state) = self.gate.0.lock() {
            state.publication = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::TryLockError;

    #[test]
    fn query_maintenance_is_atomic_without_creating_a_visible_query_lease() -> Result<()> {
        let gate = Gate::default();
        assert_eq!(
            gate.with_query_state(false, || {
                assert!(matches!(gate.0.try_lock(), Err(TryLockError::WouldBlock)));
                Ok(false)
            })?,
            Some(false)
        );
        let query = gate.query(CancellationToken::new(), false)?;
        assert_eq!(gate.with_query_state(false, || Err(conflict()))?, None);
        drop(query);
        let publication = gate.publication()?;
        assert_eq!(gate.with_query_state(true, || Err(conflict()))?, None);
        assert_eq!(gate.with_query_state(false, || Ok(false))?, Some(false));
        drop(publication);
        let query = gate.query(CancellationToken::new(), false)?;
        query.check()?;
        Ok(())
    }
}
