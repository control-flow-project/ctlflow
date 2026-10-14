use crate::clock::{self, Clock, NativeClock};
use crossfire_kernel::Result;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

struct Signal {
    revision: AtomicU64,
    checked: AtomicU64,
    changed: Notify,
    clock: NativeClock,
}

#[derive(Clone)]
pub struct EventClock(Arc<Signal>);

impl Default for EventClock {
    fn default() -> Self {
        Self(Arc::new(Signal {
            revision: AtomicU64::new(0),
            checked: AtomicU64::new(0),
            changed: Notify::new(),
            clock: NativeClock::default(),
        }))
    }
}

impl EventClock {
    pub fn changed(&self) {
        self.0.revision.fetch_add(1, Ordering::Release);
        self.0.changed.notify_waiters();
    }
    pub fn checked(&self) {
        self.0
            .checked
            .store(self.0.revision.load(Ordering::Acquire), Ordering::Release);
    }
}

impl Clock for EventClock {
    fn now(&self) -> u64 {
        self.0.clock.now()
    }
    async fn wait(&self, milliseconds: u64, cancellation: CancellationToken) -> Result<()> {
        clock::check(&cancellation)?;
        let changed = self.0.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        if self.0.checked.load(Ordering::Acquire) != self.0.revision.load(Ordering::Acquire) {
            return Ok(());
        }
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(clock::cancelled()),
            _ = changed => Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(milliseconds)) => Ok(()),
        }
    }
}
