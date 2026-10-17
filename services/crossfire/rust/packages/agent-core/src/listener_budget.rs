use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy)]
pub enum Work {
    Acquisition,
    Publication,
    NativeStart,
}
struct Slots {
    active: Arc<Semaphore>,
    queued: AtomicUsize,
}
pub struct Budget {
    acquisition: Slots,
    publication: Slots,
    native_start: Slots,
}
struct Waiting<'a>(&'a AtomicUsize);
impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl Default for Budget {
    fn default() -> Self {
        let slots = |count| Slots {
            active: Arc::new(Semaphore::new(count)),
            queued: AtomicUsize::new(0),
        };
        Self {
            acquisition: slots(16),
            publication: slots(8),
            native_start: slots(4),
        }
    }
}
fn unavailable() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Listener host work admission is unavailable; input has not been accepted",
    )
}
impl Budget {
    pub async fn acquire(
        &self,
        kind: Work,
        stop: CancellationToken,
        immediate: bool,
    ) -> Result<OwnedSemaphorePermit> {
        let slots = match kind {
            Work::Acquisition => &self.acquisition,
            Work::Publication => &self.publication,
            Work::NativeStart => &self.native_start,
        };
        if stop.is_cancelled() {
            return Err(unavailable());
        }
        if immediate {
            return slots
                .active
                .clone()
                .try_acquire_owned()
                .map_err(|_| unavailable());
        }
        if slots
            .queued
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 10000).then_some(count + 1)
            })
            .is_err()
        {
            return Err(unavailable());
        }
        let _queued = Waiting(&slots.queued);
        tokio::select! { biased; _ = stop.cancelled() => Err(unavailable()),
        permit = slots.active.clone().acquire_owned() => permit.map_err(|_| unavailable()), }
    }
}
