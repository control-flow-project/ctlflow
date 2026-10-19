use crate::{
    coordination::Coordination,
    decision_broker::Broker,
    events::invalid,
    listener_reporting::Reporter,
    local_state::LocalState,
    owner_observation::Observer,
    runtime::{Decision, Hooks, Lifecycle, ObservationEvent},
};
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_domain::statistics::Usage;
use crossfire_kernel::{Failure, Result, time::Clock};
use serde_json::Value;
use std::sync::{
    Arc, Mutex, Weak,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio_util::sync::CancellationToken;

pub struct ListenerHooks<S, C, M, T> {
    pub broker: Arc<Broker<S, C, M, T>>,
    pub observer: Arc<Observer<S, C, M, T>>,
    pub reporter: Arc<Reporter<C, T>>,
    pub pending: AtomicBool,
    pub maximum: AtomicUsize,
    pub stop: CancellationToken,
    failure: Mutex<Option<Failure>>,
    lifecycle: Mutex<Option<Weak<dyn Lifecycle>>>,
}
impl<S: LocalState, C: Coordination, M: MessagingClient, T: Clock + Send + Sync>
    ListenerHooks<S, C, M, T>
{
    pub fn new(
        broker: Arc<Broker<S, C, M, T>>,
        observer: Arc<Observer<S, C, M, T>>,
        reporter: Arc<Reporter<C, T>>,
        stop: CancellationToken,
    ) -> Self {
        Self {
            broker,
            observer,
            reporter,
            stop,
            pending: AtomicBool::new(true),
            maximum: AtomicUsize::new(65536),
            failure: Mutex::new(None),
            lifecycle: Mutex::new(None),
        }
    }
    pub fn fail(&self, error: Failure) {
        if let Ok(mut failure) = self.failure.lock()
            && failure.is_none()
        {
            *failure = Some(error);
        }
        self.stop.cancel();
    }
    pub fn check(&self) -> Result<()> {
        match self
            .failure
            .lock()
            .map_err(|_| invalid("Listener failure ownership failed"))?
            .as_ref()
        {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
    pub fn attach(&self, lifecycle: Arc<dyn Lifecycle>) -> Result<()> {
        let mut current = self
            .lifecycle
            .lock()
            .map_err(|_| invalid("Native lifecycle ownership failed"))?;
        if current.is_some() {
            return Err(invalid("A listener already owns its native lifecycle"));
        }
        *current = Some(Arc::downgrade(&lifecycle));
        Ok(())
    }
}
impl<S: LocalState, C: Coordination, M: MessagingClient, T: Clock + Send + Sync> Hooks
    for ListenerHooks<S, C, M, T>
{
    async fn request_decision(
        &self,
        decision: &Decision,
        stop: CancellationToken,
    ) -> Result<Value> {
        self.check()?;
        self.broker.request(decision, stop).await
    }
    fn decision_responded(&self, decision: &Decision) {
        if let Err(error) = self.broker.responded(decision) {
            self.fail(error);
        }
    }
    fn usage(&self, sample: &Usage) {
        if let Err(error) = self.reporter.usage(sample) {
            self.fail(error);
        }
    }
    fn pending_decisions(&self) -> bool {
        match self.broker.unresolved() {
            Ok(pending) => pending,
            Err(error) => {
                self.fail(error);
                true
            }
        }
    }
    fn pending_input(&self) -> bool {
        self.stop.is_cancelled() || self.pending.load(Ordering::Acquire)
    }
    fn observe(&self, event: ObservationEvent) {
        let native = self
            .lifecycle
            .lock()
            .map_err(|_| invalid("Native lifecycle ownership failed"))
            .and_then(|lifecycle| {
                lifecycle
                    .as_ref()
                    .and_then(Weak::upgrade)
                    .map(|native| native.current())
                    .transpose()
            });
        match native.and_then(|native| {
            self.observer
                .observe(event, self.maximum.load(Ordering::Acquire), native)
        }) {
            Ok(()) => {}
            Err(error) => self.fail(error),
        }
    }
}
