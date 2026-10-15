mod acquisition;
mod chat_acquisition;
mod endpoint;
mod publication;
mod reporting;

use crate::{
    artifacts::Store,
    chat_publication::Publication,
    controller_input::{self, Acknowledgment},
    coordination::Coordination,
    decision_broker::Broker,
    delivery_policy::Policy,
    events::{Event, invalid},
    history_queries::Queries,
    listener_budget::Budget,
    listener_control::Control,
    listener_hooks::ListenerHooks,
    listener_maintenance::{self, Maintenance},
    listener_reporting::Reporter,
    local_state::LocalState,
    matrix::Matrix,
    owner_observation::{self, Observer},
    profile::Profile,
    receive_snapshots::{self, Wake},
    receive_state,
    receiver_gate::Gate,
    release_notices,
    runtime::{Connection, Hooks, InputPriority, Lifecycle, TurnControl},
    scheduled,
    source_control::Controls,
    steering_receipts::Receipts,
};
use crossfire_contracts::{call::Call, operations::OperationId, release, validation as check};
use crossfire_domain::runtime::values::HistoryMode;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
pub use endpoint::{ControlEndpoint, Reply};
use serde_json::json;
use std::{
    collections::BTreeSet,
    future::Future,
    sync::{Arc, Mutex, atomic::Ordering},
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio_util::sync::CancellationToken;

pub trait Factory<H: Hooks>: Send + Sync {
    type Native: Connection + TurnControl + Lifecycle + 'static;
    fn start(
        &self,
        hooks: Arc<H>,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Self::Native>> + Send;
}
#[derive(Clone)]
pub struct Options {
    pub profile: Profile,
    pub file: String,
    pub release: String,
    pub history_mode: HistoryMode,
    pub room: Option<String>,
    pub limit: usize,
    pub poll_ms: u64,
    pub debounce_ms: i64,
    pub reconcile_ms: i64,
}
impl Options {
    pub fn validate(&self) -> Result<()> {
        crate::profile::value(&self.profile)?;
        release::identity(&self.release)?;
        if let Some(room) = &self.room {
            check::room_id(&json!(room))?;
        }
        if self.file.is_empty()
            || !(1..=100).contains(&self.limit)
            || !(100..=30000).contains(&self.poll_ms)
            || !(0..=60000).contains(&self.debounce_ms)
            || !(1000..=600000).contains(&self.reconcile_ms)
        {
            return Err(invalid(
                "Invalid listener acquisition or reconciliation configuration",
            ));
        }
        Ok(())
    }
}
pub struct Resources<S, C, M, A, T> {
    pub storage: Arc<S>,
    pub coordination: Arc<C>,
    pub matrix: Arc<M>,
    pub acknowledgment: Arc<A>,
    pub control: Arc<Control>,
    pub budget: Arc<Budget>,
    pub clock: T,
    pub ready: Option<tokio::sync::watch::Sender<Option<Arc<dyn ControlEndpoint>>>>,
}
pub type AgentQueries<S, C, M, T> = Queries<S, M, C, Store<S, T>, T>;
struct State {
    policy: Policy,
    joined: BTreeSet<String>,
    since: Option<String>,
    synchronized: bool,
    controlling: bool,
    wake: Option<Wake>,
    window: i64,
    revision: u64,
    retired: BTreeSet<String>,
    access_at: Option<i64>,
    ordinary: CancellationToken,
    sending: Option<CancellationToken>,
}
struct Sending<'a> {
    state: &'a Mutex<State>,
    changed: &'a Notify,
}
impl Drop for Sending<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.sending = None;
        }
        self.changed.notify_waiters();
    }
}
pub struct Receiver<S, C, M, N, A, T> {
    options: Options,
    resources: Resources<S, C, M, A, T>,
    native: Arc<N>,
    hooks: Arc<ListenerHooks<S, C, M, T>>,
    pub queries: Arc<AgentQueries<S, C, M, T>>,
    artifacts: Arc<Store<S, T>>,
    chat: Publication<S, N, Store<S, T>>,
    priority: Publication<S, N, Store<S, T>>,
    controlled: controller_input::Publisher<S, N, A, T>,
    scheduled: scheduled::Publisher<S, N, C, T>,
    updates: release_notices::Notices<S>,
    maintenance: Maintenance<S, C, T>,
    receipts: Receipts<Observer<S, C, M, T>, T>,
    controls: Controls<Arc<S>>,
    state: Mutex<State>,
    access: AsyncMutex<()>,
    gate: Gate,
    changed: Notify,
}
pub async fn run<S, C, M, A, T, F>(
    resources: Resources<S, C, M, A, T>,
    factory: F,
    options: Options,
    stop: CancellationToken,
) -> Result<()>
where
    S: LocalState + 'static,
    C: Coordination + 'static,
    M: Matrix + 'static,
    A: Acknowledgment + 'static,
    T: Clock + Clone + Send + Sync + 'static,
    F: Factory<ListenerHooks<S, C, M, T>>,
{
    options.validate()?;
    resources.control.wait(stop.clone()).await?;
    let current = resources
        .coordination
        .call(&Call::new(OperationId::Release), stop.clone())
        .await?;
    if release::parse(&current)?.release != options.release {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Installed Crossfire software differs from the current release; obtain owner consent and update the controller before connecting",
        ));
    }
    let lifetime = stop.child_token();
    let reporter = Arc::new(Reporter::new(
        resources.coordination.clone(),
        resources.control.clone(),
        resources.clock.clone(),
        options.profile.id.clone(),
        &options.profile.account.user_id,
        options.release.clone(),
    )?);
    let observer = Arc::new(Observer::open(
        resources.storage.clone(),
        resources.coordination.clone(),
        resources.matrix.clone(),
        resources.clock.clone(),
        owner_observation::Options {
            profile: options.profile.clone(),
            file: format!("{}.observation", options.file),
            history_mode: options.history_mode,
        },
        reporter.ready(),
    )?);
    let broker = Arc::new(Broker::open(
        resources.storage.clone(),
        resources.coordination.clone(),
        resources.matrix.clone(),
        resources.clock.clone(),
        options.profile.clone(),
        &format!("{}.decisions", options.file),
        reporter.ready(),
    )?);
    let hooks = Arc::new(ListenerHooks::new(
        broker,
        observer,
        reporter,
        lifetime.clone(),
    ));
    let started = async {
        hooks.reporter.activate(lifetime.clone()).await?;
        factory
            .start(hooks.clone(), lifetime.clone())
            .await
            .map(Arc::new)
    }
    .await;
    let native = match started {
        Ok(native) => native,
        Err(error) => {
            lifetime.cancel();
            close_reporting(&hooks).await?;
            return Err(error);
        }
    };
    let ready = resources.ready.clone();
    let opened = Receiver::open(resources, options, native.clone(), hooks.clone());
    let result = match opened {
        Ok(receiver) => {
            let receiver = Arc::new(receiver);
            let work = async {
                receiver.initialize().await?;
                if let Some(ready) = &ready {
                    ready.send_replace(Some(receiver.clone()));
                }
                tokio::try_join!(receiver.acquire(), receiver.publish(), receiver.report())
                    .map(|_| ())
            };
            tokio::pin!(work);
            let native_stop = native.lifetime();
            let result = tokio::select! { biased; _ = stop.cancelled() => Ok(()), _ = native_stop.cancelled() => Err(Failure::new(ErrorCode::Unavailable, "Owned native runtime stopped; exact saved histories and original pending input remain retained")), result = &mut work => result };
            if let Err(error) = &result {
                hooks.fail(error.clone());
            }
            lifetime.cancel();
            result
        }
        Err(error) => {
            lifetime.cancel();
            Err(error)
        }
    };
    let closed = native.close().await;
    if let Some(ready) = ready {
        ready.send_replace(None);
    }
    let reporting = close_reporting(&hooks).await;
    hooks.check()?;
    result.and(closed).and(reporting)
}
async fn close_reporting<S: LocalState, C: Coordination, M: Matrix, T: Clock + Send + Sync>(
    hooks: &ListenerHooks<S, C, M, T>,
) -> Result<()> {
    let deadline = async {
        let stop = CancellationToken::new();
        let decisions = hooks.broker.close(stop.clone()).await;
        let observations = hooks.observer.close(stop.clone()).await;
        let reporting = hooks.reporter.pause(stop).await;
        decisions.and(observations).and(reporting)
    };
    tokio::time::timeout(Duration::from_secs(15), deadline).await.map_err(|_| Failure::new(ErrorCode::Unavailable, "Listener shutdown reporting exceeded its deadline; original journals remain retained"))?
}
impl<
    S: LocalState,
    C: Coordination,
    M: Matrix,
    N: Connection + TurnControl + Lifecycle + 'static,
    A: Acknowledgment,
    T: Clock + Clone + Send + Sync + 'static,
> Receiver<S, C, M, N, A, T>
{
    fn open(
        resources: Resources<S, C, M, A, T>,
        options: Options,
        native: Arc<N>,
        hooks: Arc<ListenerHooks<S, C, M, T>>,
    ) -> Result<Self> {
        hooks.attach(native.clone())?;
        let artifacts = Arc::new(Store::open(
            resources.storage.clone(),
            &format!("{}.messages", options.file),
            resources.clock.clone(),
        )?);
        let controls = Controls::open(
            resources.storage.clone(),
            &format!("{}.control", options.file),
            native.session_id(),
        )?;
        let chat = Publication::open(
            resources.storage.clone(),
            native.clone(),
            artifacts.clone(),
            options.profile.settings.clone(),
            &format!("{}.chat-publication", options.file),
            options.history_mode,
            None,
        )?;
        let priority = Publication::open(
            resources.storage.clone(),
            native.clone(),
            artifacts.clone(),
            options.profile.settings.clone(),
            &format!("{}.steering-publication", options.file),
            options.history_mode,
            Some(InputPriority::Steering),
        )?;
        let gate = Gate::default();
        let queries = Arc::new(Queries {
            storage: resources.storage.clone(),
            matrix: resources.matrix.clone(),
            coordination: resources.coordination.clone(),
            artifacts: artifacts.clone(),
            clock: resources.clock.clone(),
            profile: options.profile.clone(),
            file: options.file.clone(),
            gate: gate.clone(),
        });
        let controlled = controller_input::Publisher::new(
            resources.storage.clone(),
            native.clone(),
            artifacts.clone(),
            resources.control.clone(),
            resources.acknowledgment.clone(),
            resources.clock.clone(),
            format!("{}.controller-input", options.file),
        );
        let scheduled = scheduled::Publisher::new(
            resources.storage.clone(),
            native.clone(),
            resources.coordination.clone(),
            artifacts.clone(),
            resources.clock.clone(),
            scheduled::Options {
                file: format!("{}.wake-input", options.file),
                agent_id: options.profile.id.clone(),
            },
        );
        let updates = release_notices::Notices::open(
            resources.storage.clone(),
            &options.file,
            &options.release,
            &options.profile.settings.owner,
            native.session_id(),
        )?;
        let maintenance = Maintenance::open(
            resources.storage.clone(),
            resources.coordination.clone(),
            resources.clock.clone(),
            listener_maintenance::Options {
                file: format!("{}.maintenance", options.file),
                agent_id: options.profile.id.clone(),
                interval_ms: options.reconcile_ms,
            },
        )?;
        let receipts = Receipts::new(hooks.observer.clone(), resources.clock.clone());
        let since = receive_state::sync_cursor(resources.storage.as_ref(), &options.file)?;
        let wake = receive_snapshots::load_wake(resources.storage.as_ref(), &options.file)?;
        Ok(Self {
            options,
            resources,
            native,
            hooks,
            queries,
            artifacts,
            chat,
            priority,
            controlled,
            scheduled,
            updates,
            maintenance,
            receipts,
            controls,
            state: Mutex::new(State {
                policy: Policy {
                    active: false,
                    mode: crossfire_domain::identity::WakeMode::Selected,
                    rooms: Default::default(),
                    senders: Default::default(),
                    max_message_bytes: 65536,
                    idle_timeout_seconds: 1800,
                    owner_conversation: None,
                },
                joined: Default::default(),
                since,
                synchronized: false,
                controlling: false,
                wake,
                window: 0,
                revision: 0,
                retired: Default::default(),
                access_at: None,
                ordinary: CancellationToken::new(),
                sending: None,
            }),
            access: AsyncMutex::new(()),
            gate,
            changed: Notify::new(),
        })
    }
    async fn initialize(&self) -> Result<()> {
        self.refresh(self.hooks.stop.clone()).await?;
        crate::owner_authority::authorize(
            self.resources.coordination.as_ref(),
            self.resources.matrix.as_ref(),
            &self.options.profile,
            self.hooks.stop.clone(),
        )
        .await?;
        receive_state::flush(
            self.resources.storage.as_ref(),
            self.resources.matrix.as_ref(),
            &self.options.file,
            self.hooks.stop.clone(),
        )
        .await?;
        self.controls
            .recover(self.native.as_ref(), self.hooks.stop.clone())
            .await?;
        let joined =
            crate::receive_pages::joined(self.resources.matrix.as_ref(), self.hooks.stop.clone())
                .await?;
        receive_state::retain_joined(self.resources.storage.as_ref(), &self.options.file, &joined)?;
        self.state
            .lock()
            .map_err(|_| invalid("Receiver ownership failed"))?
            .joined = joined;
        Ok(())
    }
    fn now(&self) -> Result<i64> {
        self.resources.clock.now()
    }
    fn policy(&self) -> Result<Policy> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Receiver ownership failed"))?
            .policy
            .clone())
    }
    fn rooms(&self) -> Result<BTreeSet<String>> {
        Ok(self
            .policy()?
            .rooms
            .into_iter()
            .filter(|(_, room)| !room.muted)
            .map(|(room, _)| room)
            .collect())
    }
    fn accept(&self, event: &Event) -> bool {
        !crate::events::notice_content(&event.content)
            && !(event.kind == "m.room.message"
                && event.sender == self.options.profile.account.user_id)
            && self.controls.accepts(event).unwrap_or_else(|error| {
                self.hooks.fail(error);
                false
            })
    }
    fn reserve(&self, pending: bool) -> Result<bool> {
        match self.gate.pending(pending) {
            Ok(()) => Ok(true),
            Err(error) if error.code == ErrorCode::Conflict => Ok(false),
            Err(error) => Err(error),
        }
    }
    fn changed(&self) -> Result<()> {
        self.changed.notify_waiters();
        Ok(())
    }
    async fn wait(&self, milliseconds: u64) -> Result<()> {
        tokio::select! { biased; _ = self.hooks.stop.cancelled() => self.hooks.check(), _ = self.changed.notified() => Ok(()), _ = tokio::time::sleep(Duration::from_millis(milliseconds.max(1))) => Ok(()) }
    }
    async fn cancel_delivery(&self) -> Result<()> {
        self.gate.interrupt_query()?;
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let sending = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .sending
                .clone();
            let Some(sending) = sending else {
                return Ok(());
            };
            sending.cancel();
            tokio::select! { _ = self.hooks.stop.cancelled() => return Err(Failure::new(ErrorCode::Unavailable, "Publication cancellation stopped")), _ = notified => {} }
        }
    }
}
