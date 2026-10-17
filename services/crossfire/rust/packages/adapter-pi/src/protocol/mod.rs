mod worker;
use crate::options;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_process::{self, NativeCommand, NativeProcess};
use crossfire_adapter_runtime::clock;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsStr,
    future::Future,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Notify, mpsc, oneshot},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

pub const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
pub trait Events: Send + Sync {
    fn event(&self, value: Value) -> Result<()>;
}
pub trait Protocol: Send + Sync {
    fn lifetime(&self) -> CancellationToken;
    fn version(&self) -> &str;
    fn request(
        &self,
        command: &str,
        parameters: &Value,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn control(
        &self,
        operation: &str,
        parameters: &Value,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn notify(
        &self,
        value: &Value,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn close(&self) -> impl Future<Output = Result<()>> + Send;
}

struct Pending {
    command: Option<String>,
    response: oneshot::Sender<Result<Value>>,
    deadline: Instant,
}
#[derive(Default)]
struct Tracker {
    pending: BTreeMap<String, Pending>,
    failure: Option<Failure>,
}
struct State {
    tracker: Mutex<Tracker>,
    lifetime: CancellationToken,
    closed: CancellationToken,
    changed: Notify,
    stop_failure: Mutex<Option<Failure>>,
}
impl State {
    fn fail(&self, failure: Failure) {
        let mut tracker = match self.tracker.lock() {
            Ok(tracker) => tracker,
            Err(poisoned) => poisoned.into_inner(),
        };
        if tracker.failure.is_none() {
            tracker.failure = Some(failure.clone());
        }
        for pending in std::mem::take(&mut tracker.pending).into_values() {
            let _closed = pending.response.send(Err(failure.clone()));
        }
        self.lifetime.cancel();
    }
    fn failure(&self) -> Failure {
        self.tracker
            .lock()
            .ok()
            .and_then(|tracker| tracker.failure.clone())
            .unwrap_or_else(|| error("Owned Pi connection closed"))
    }
}
struct Write {
    bytes: Vec<u8>,
    cancellation: CancellationToken,
    flushed: oneshot::Sender<Result<()>>,
}
pub struct Rpc {
    state: Arc<State>,
    ordinary: mpsc::Sender<Write>,
    urgent: mpsc::Sender<Write>,
    version: String,
}
struct Registration {
    state: Arc<State>,
    id: String,
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut tracker) = self.state.tracker.lock() {
            tracker.pending.remove(&self.id);
        }
        self.state.changed.notify_one();
    }
}
pub struct Launch<'a> {
    pub binary: &'a OsStr,
    pub workspace: &'a Path,
    pub state: &'a Path,
    pub home: &'a Path,
    pub profile: &'a str,
    pub history: &'a Path,
    pub instructions: &'a str,
}
fn error(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

impl Rpc {
    pub fn fail(&self, failure: Failure) {
        self.state.fail(failure);
    }
    pub async fn start(
        input: &Launch<'_>,
        events: Arc<impl Events + 'static>,
        cancellation: CancellationToken,
    ) -> Result<Self> {
        clock::check(&cancellation)?;
        let directory = PrivateDirectory::open(input.home, false)?;
        PrivateDirectory::open(input.state, false)?;
        let environment = BTreeMap::from([
            (
                "PI_CODING_AGENT_DIR".into(),
                Some(input.home.as_os_str().to_owned()),
            ),
            (
                "CROSSFIRE_PROJECT".into(),
                Some(input.state.as_os_str().to_owned()),
            ),
            ("CROSSFIRE_AGENT_NAME".into(), Some(input.profile.into())),
            ("CODEX_THREAD_ID".into(), None),
        ]);
        let version = crossfire_adapter_process::capture(
            &NativeCommand {
                binary: input.binary.to_owned(),
                arguments: vec!["--version".into()],
                workspace: input.workspace.to_owned(),
                environment: environment.clone(),
                input: false,
            },
            4096,
            Duration::from_secs(10),
            cancellation.clone(),
        )
        .await?;
        if !version.status.success() {
            return Err(error(
                "Cannot run Pi --version; install @earendil-works/pi-coding-agent 1.0.0",
            ));
        }
        options::version(&version.output)?;
        let extension = input.home.join("crossfire-extension.mjs");
        let instructions = input.home.join("crossfire-instructions.txt");
        if input.instructions.len() > 8 * 1024 * 1024 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Native Pi instructions exceed their byte bound",
            ));
        }
        directory.write_atomic(
            "crossfire-extension.mjs",
            include_bytes!("../../assets/crossfire-extension.mjs"),
        )?;
        directory.write_atomic("crossfire-instructions.txt", input.instructions.as_bytes())?;
        let mut native = NativeProcess::guarded(
            &NativeCommand {
                binary: input.binary.to_owned(),
                workspace: input.workspace.to_owned(),
                environment,
                input: true,
                arguments: vec![
                    "--mode".into(),
                    "rpc".into(),
                    "--offline".into(),
                    "--no-extensions".into(),
                    "--no-skills".into(),
                    "--no-prompt-templates".into(),
                    "--no-themes".into(),
                    "--no-approve".into(),
                    "--session".into(),
                    input.history.as_os_str().to_owned(),
                    "--append-system-prompt".into(),
                    instructions.into_os_string(),
                    "--extension".into(),
                    extension.into_os_string(),
                ],
            },
            input.home,
            &identity::hash(
                input
                    .history
                    .to_str()
                    .ok_or_else(|| error("Native Pi history must use a valid Unicode path"))?,
            ),
        )?;
        let input = native.input()?;
        let output = native.output()?;
        let errors = native.errors()?;
        let state = Arc::new(State {
            tracker: Mutex::new(Tracker::default()),
            lifetime: cancellation.child_token(),
            closed: CancellationToken::new(),
            changed: Notify::new(),
            stop_failure: Mutex::new(None),
        });
        let (ordinary, ordinary_receive) = mpsc::channel(64);
        let (urgent, urgent_receive) = mpsc::channel(16);
        worker::start(
            native,
            worker::Pipes {
                input,
                output,
                errors,
            },
            Arc::clone(&state),
            events,
            ordinary_receive,
            urgent_receive,
        );
        Ok(Self {
            state,
            ordinary,
            urgent,
            version: version.output.trim().to_owned(),
        })
    }
    async fn send(
        &self,
        value: &Value,
        urgent: bool,
        cancellation: CancellationToken,
    ) -> Result<()> {
        clock::check(&cancellation)?;
        let mut bytes =
            serde_json::to_vec(value).map_err(|_| error("Invalid native Pi command"))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Native Pi command exceeds its finite byte budget",
            ));
        }
        bytes.push(b'\n');
        let (flushed, confirmation) = oneshot::channel();
        let sender = if urgent { &self.urgent } else { &self.ordinary };
        tokio::select! { biased; _ = self.state.lifetime.cancelled() => return Err(self.state.failure()), _ = cancellation.cancelled() => return Err(clock::cancelled()),
        written = sender.send(Write { bytes, cancellation: cancellation.clone(), flushed }) => written.map_err(|_| error("Native Pi input queue closed"))? }
        tokio::select! { biased; written = confirmation => written.map_err(|_| error("Native Pi write confirmation was lost"))?, _ = self.state.lifetime.cancelled() => Err(self.state.failure()), _ = cancellation.cancelled() => Err(clock::cancelled()) }
    }
    fn pending(&self, id: &str, command: Option<&str>) -> Result<oneshot::Receiver<Result<Value>>> {
        let mut tracker = self
            .state
            .tracker
            .lock()
            .map_err(|_| error("Native Pi request ownership failed"))?;
        if let Some(failure) = &tracker.failure {
            return Err(failure.clone());
        }
        if tracker.pending.len() >= 80 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Native Pi request budget is exhausted",
            ));
        }
        let (response, receiver) = oneshot::channel();
        tracker.pending.insert(
            id.to_owned(),
            Pending {
                command: command.map(str::to_owned),
                response,
                deadline: Instant::now() + Duration::from_secs(30),
            },
        );
        self.state.changed.notify_one();
        Ok(receiver)
    }
    async fn wait(
        &self,
        receiver: oneshot::Receiver<Result<Value>>,
        cancellation: CancellationToken,
    ) -> Result<Value> {
        tokio::select! { biased; response = receiver => response.map_err(|_| error("Native Pi request lost its response"))?,
        _ = self.state.lifetime.cancelled() => Err(self.state.failure()), _ = cancellation.cancelled() => Err(clock::cancelled()) }
    }
    async fn request_priority(
        &self,
        command: &str,
        parameters: &Value,
        cancellation: CancellationToken,
        urgent: bool,
    ) -> Result<Value> {
        let parameters = parameters
            .as_object()
            .filter(|value| !value.contains_key("type") && !value.contains_key("id"))
            .ok_or_else(|| error("Invalid native Pi command parameters"))?;
        let id = identity::id();
        let response = self.pending(&id, Some(command))?;
        let _registration = Registration {
            state: Arc::clone(&self.state),
            id: id.clone(),
        };
        let mut value = parameters.clone();
        value.insert("type".to_owned(), json!(command));
        value.insert("id".to_owned(), json!(id));
        self.send(&Value::Object(value), urgent, cancellation.clone())
            .await?;
        self.wait(response, cancellation).await
    }
}
impl Protocol for Rpc {
    fn lifetime(&self) -> CancellationToken {
        self.state.lifetime.clone()
    }
    fn version(&self) -> &str {
        &self.version
    }
    async fn request(
        &self,
        command: &str,
        parameters: &Value,
        cancellation: CancellationToken,
    ) -> Result<Value> {
        self.request_priority(command, parameters, cancellation, command == "abort")
            .await
    }
    async fn control(
        &self,
        operation: &str,
        parameters: &Value,
        cancellation: CancellationToken,
    ) -> Result<Value> {
        if !["state", "instructions", "deliver", "interrupt"].contains(&operation) {
            return Err(error("Unsupported private Pi control"));
        }
        let parameters = parameters
            .as_object()
            .filter(|value| !value.contains_key("id") && !value.contains_key("operation"))
            .ok_or_else(|| error("Invalid private Pi control parameters"))?;
        let id = identity::id();
        let response = self.pending(&id, None)?;
        let _registration = Registration {
            state: Arc::clone(&self.state),
            id: id.clone(),
        };
        let mut value = parameters.clone();
        value.insert("id".to_owned(), json!(id));
        value.insert("operation".to_owned(), json!(operation));
        let encoded = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&value).map_err(|_| error("Invalid private Pi control"))?);
        self.request_priority(
            "prompt",
            &json!({"message":"/crossfire-control ".to_owned() + &encoded}),
            cancellation.clone(),
            matches!(operation, "state" | "interrupt"),
        )
        .await?;
        self.wait(response, cancellation).await
    }
    async fn notify(&self, value: &Value, cancellation: CancellationToken) -> Result<()> {
        self.send(value, true, cancellation).await
    }
    async fn close(&self) -> Result<()> {
        self.state.fail(error("Owned Pi connection closed"));
        self.state.closed.cancelled().await;
        self.state
            .stop_failure
            .lock()
            .map_err(|_| error("Native Pi cleanup ownership failed"))?
            .clone()
            .map_or(Ok(()), Err)
    }
}
impl Drop for Rpc {
    fn drop(&mut self) {
        self.state.fail(error("Owned Pi connection disposed"));
    }
}
