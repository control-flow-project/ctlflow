mod endpoint;
mod frame;
mod worker;

use crate::protocol::{Callbacks, Protocol, Reply, RequestId};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Notify, mpsc, oneshot},
    task::JoinHandle,
    time::Instant,
};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
pub fn validate_endpoint(value: &str) -> Result<()> {
    endpoint::validate(value)
}

struct Pending {
    response: oneshot::Sender<Result<Reply>>,
    deadline: Instant,
    sent: bool,
}

struct Decision {
    cancellation: CancellationToken,
    thread: Option<Value>,
    turn: Option<Value>,
}

#[derive(Default)]
struct Tracker {
    sequence: i64,
    failure: Option<Failure>,
    pending: BTreeMap<i64, Pending>,
    decisions: BTreeMap<RequestId, Decision>,
}

struct State {
    tracker: Mutex<Tracker>,
    lifetime: CancellationToken,
    deadline_changed: Notify,
}

impl State {
    fn inspect<T>(&self, action: impl FnOnce(&mut Tracker) -> Result<T>) -> Result<T> {
        let mut tracker = self
            .tracker
            .lock()
            .map_err(|_| error("Codex native state ownership failed"))?;
        if let Some(failure) = &tracker.failure {
            return Err(failure.clone());
        }
        action(&mut tracker)
    }

    fn fail(&self, reason: Failure) {
        let mut tracker = match self.tracker.lock() {
            Ok(value) => value,
            Err(poisoned) => poisoned.into_inner(),
        };
        if tracker.failure.is_none() {
            tracker.failure = Some(reason.clone());
        }
        for pending in std::mem::take(&mut tracker.pending).into_values() {
            let _closed = pending.response.send(Err(reason.clone()));
        }
        for decision in std::mem::take(&mut tracker.decisions).into_values() {
            decision.cancellation.cancel();
        }
        self.lifetime.cancel();
    }

    fn reason(&self) -> Failure {
        self.tracker
            .lock()
            .ok()
            .and_then(|value| value.failure.clone())
            .unwrap_or_else(|| error("Codex native transport closed"))
    }
}

struct Write {
    message: Message,
    request_id: Option<i64>,
    cancellation: CancellationToken,
    confirmed: Option<oneshot::Sender<Result<()>>>,
}

struct Jobs {
    reading: JoinHandle<()>,
    writing: JoinHandle<()>,
}
impl Drop for Jobs {
    fn drop(&mut self) {
        self.reading.abort();
        self.writing.abort();
    }
}

pub struct WebSocketProtocol {
    state: Arc<State>,
    urgent: mpsc::Sender<Write>,
    ordinary: mpsc::Sender<Write>,
    jobs: Mutex<Option<Jobs>>,
    closed: CancellationToken,
    timeout: Duration,
}

impl WebSocketProtocol {
    pub async fn open(
        endpoint: &str,
        token: &Secret,
        timeout: Duration,
        callbacks: Arc<impl Callbacks + 'static>,
        cancellation: CancellationToken,
    ) -> Result<Self> {
        if timeout < Duration::from_millis(100) || timeout > Duration::from_secs(300) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid native Codex deadline",
            ));
        }
        let socket = endpoint::connect(endpoint, token, timeout, &cancellation).await?;
        let state = Arc::new(State {
            tracker: Mutex::new(Tracker::default()),
            lifetime: cancellation.child_token(),
            deadline_changed: Notify::new(),
        });
        let (urgent, urgent_receive) = mpsc::channel(24);
        let (ordinary, ordinary_receive) = mpsc::channel(64);
        let (reading, writing) = worker::start(
            socket,
            Arc::clone(&state),
            callbacks,
            urgent.clone(),
            urgent_receive,
            ordinary_receive,
            timeout,
        );
        Ok(Self {
            state,
            urgent,
            ordinary,
            jobs: Mutex::new(Some(Jobs { reading, writing })),
            closed: CancellationToken::new(),
            timeout,
        })
    }

    async fn enqueue(
        &self,
        value: Value,
        request_id: Option<i64>,
        cancellation: CancellationToken,
        urgent: bool,
        confirmed: Option<oneshot::Sender<Result<()>>>,
    ) -> Result<()> {
        let bytes = serde_json::to_string(&value)
            .map_err(|_| error("Cannot encode native Codex request"))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(error("Codex request exceeds the native frame budget"));
        }
        let message = Write {
            message: Message::Text(bytes.into()),
            request_id,
            cancellation: cancellation.clone(),
            confirmed,
        };
        let sender = if urgent { &self.urgent } else { &self.ordinary };
        tokio::select! {
            biased;
            _ = self.state.lifetime.cancelled() => Err(self.state.reason()),
            _ = cancellation.cancelled() => Err(error("Codex request cancelled before native transmission")),
            result = sender.send(message) => result.map_err(|_| self.state.reason()),
        }
    }
}

impl Protocol for WebSocketProtocol {
    fn lifetime(&self) -> CancellationToken {
        self.state.lifetime.clone()
    }

    async fn request(
        &self,
        method: &str,
        params: &Value,
        cancellation: CancellationToken,
    ) -> Result<Reply> {
        if cancellation.is_cancelled() {
            return Err(error("Codex request cancelled before native transmission"));
        }
        frame::method(method)?;
        let (response, receive) = oneshot::channel();
        let id = self.state.inspect(|tracker| {
            if tracker.pending.len() >= 64 {
                return Err(error("Too many pending native Codex requests"));
            }
            tracker.sequence = tracker
                .sequence
                .checked_add(1)
                .filter(|value| *value <= 9_007_199_254_740_991)
                .ok_or_else(|| error("Codex native request identity limit reached"))?;
            let id = tracker.sequence;
            tracker.pending.insert(
                id,
                Pending {
                    response,
                    deadline: Instant::now() + self.timeout,
                    sent: false,
                },
            );
            Ok(id)
        })?;
        self.state.deadline_changed.notify_one();
        if let Err(failure) = self
            .enqueue(
                json!({"id":id,"method":method,"params":params}),
                Some(id),
                cancellation.clone(),
                method == "turn/interrupt",
                None,
            )
            .await
        {
            let _removed = self.state.inspect(|tracker| {
                tracker.pending.remove(&id);
                Ok(())
            });
            return Err(failure);
        }
        tokio::select! {
            biased;
            result = receive => result.map_err(|_| self.state.reason())?,
            _ = self.state.lifetime.cancelled() => Err(self.state.reason()),
            _ = cancellation.cancelled() => Err(error("Codex request cancelled; native receipt may still be pending")),
        }
    }

    async fn notify(&self, method: &str, cancellation: CancellationToken) -> Result<()> {
        frame::method(method)?;
        let (confirmed, receive) = oneshot::channel();
        self.enqueue(
            json!({"method":method}),
            None,
            cancellation.clone(),
            true,
            Some(confirmed),
        )
        .await?;
        tokio::select! {
            biased;
            result = receive => result.map_err(|_| self.state.reason())?,
            _ = self.state.lifetime.cancelled() => Err(self.state.reason()),
            _ = cancellation.cancelled() => Err(error("Codex notification cancelled")),
        }
    }

    async fn close(&self) -> Result<()> {
        self.state.fail(error("Codex connection closed"));
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| error("Codex native task ownership failed"))?
            .take();
        if let Some(mut jobs) = jobs {
            let completed = self.closed.clone();
            struct Completion(CancellationToken);
            impl Drop for Completion {
                fn drop(&mut self) {
                    self.0.cancel();
                }
            }
            let _completion = Completion(completed);
            let (reading, writing) = tokio::join!(&mut jobs.reading, &mut jobs.writing);
            reading.map_err(|_| error("Codex native reader failed during shutdown"))?;
            writing.map_err(|_| error("Codex native writer failed during shutdown"))?;
        } else {
            self.closed.cancelled().await;
        }
        Ok(())
    }
}

impl Drop for WebSocketProtocol {
    fn drop(&mut self) {
        self.state.fail(error("Codex connection disposed"));
        let jobs = match self.jobs.get_mut() {
            Ok(value) => value,
            Err(poisoned) => poisoned.into_inner(),
        };
        jobs.take();
        self.closed.cancel();
    }
}

fn error(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}
