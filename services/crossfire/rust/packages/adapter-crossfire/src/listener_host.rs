use crossfire_adapter_http::server::{
    self, Body, Incoming, Limits, Listener, Peer, Request, Response,
};
use crossfire_agent_core::{
    listener::ControlEndpoint,
    listener_budget::Budget,
    local_state::{self, LocalState},
};
use crossfire_contracts::{release, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use subtle::ConstantTimeEq;
use tokio::{
    net::TcpListener,
    sync::{Mutex as AsyncMutex, Semaphore, watch},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

struct Entry {
    secret: String,
    file: String,
    release: String,
    ready: watch::Receiver<Option<Arc<dyn ControlEndpoint>>>,
    stop: CancellationToken,
}
struct Registry {
    bindings: BTreeMap<String, Arc<Entry>>,
    closing: bool,
}
struct State<S> {
    storage: Arc<S>,
    bindings: Mutex<Registry>,
    requests: Arc<Semaphore>,
    stop: CancellationToken,
    port: u16,
}
pub struct Host<S> {
    state: Arc<State<S>>,
    task: AsyncMutex<Option<JoinHandle<Result<()>>>>,
    pub budget: Arc<Budget>,
}
pub struct Binding<S> {
    state: Arc<State<S>>,
    entry: Arc<Entry>,
    name: String,
    ready: watch::Sender<Option<Arc<dyn ControlEndpoint>>>,
}
pub struct Options {
    pub name: String,
    pub release: String,
    pub cursor: String,
    pub stop: CancellationToken,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}
impl<S: LocalState + 'static> Host<S> {
    pub async fn open(storage: Arc<S>) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Cannot open the private listener host",
            )
        })?;
        let port = listener
            .local_addr()
            .map_err(|_| invalid("Cannot inspect the listener host address"))?
            .port();
        let state = Arc::new(State {
            storage,
            bindings: Mutex::new(Registry {
                bindings: BTreeMap::new(),
                closing: false,
            }),
            requests: Arc::new(Semaphore::new(16)),
            stop: CancellationToken::new(),
            port,
        });
        let task = tokio::spawn(server::serve(
            Listener::Tcp(listener),
            state.clone(),
            handle::<S>,
            Limits {
                connections: 32,
                idle: Duration::from_secs(5),
                request: Duration::from_secs(45),
            },
            state.stop.clone(),
        ));
        Ok(Self {
            state,
            task: AsyncMutex::new(Some(task)),
            budget: Arc::new(Budget::default()),
        })
    }
    pub fn bind(&self, options: Options) -> Result<Binding<S>> {
        if !valid_name(&options.name) || self.state.stop.is_cancelled() {
            return Err(invalid("Invalid listener host binding"));
        }
        release::identity(&options.release)?;
        let parent = Path::new(&options.cursor)
            .parent()
            .ok_or_else(|| invalid("Listener cursor has no owned parent directory"))?;
        let file = parent
            .join("listener.json")
            .to_str()
            .ok_or_else(|| invalid("Listener metadata path is not UTF-8"))?
            .to_owned();
        let mut bindings = self
            .state
            .bindings
            .lock()
            .map_err(|_| invalid("Listener host ownership failed"))?;
        if bindings.closing
            || bindings.bindings.len() >= 10000
            || bindings.bindings.contains_key(&options.name)
            || bindings
                .bindings
                .values()
                .any(|binding| binding.file == file)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Duplicate listener name or private metadata location",
            ));
        }
        let secret: String = identity::random_bytes::<32>()?
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let (ready, status) = watch::channel(None);
        local_state::write(
            self.state.storage.as_ref(),
            &file,
            &json!({"port":self.state.port,"secret":secret,"binding":options.name}),
            65536,
        )?;
        let entry = Arc::new(Entry {
            secret,
            file,
            release: options.release,
            ready: status,
            stop: options.stop,
        });
        bindings
            .bindings
            .insert(options.name.clone(), entry.clone());
        Ok(Binding {
            state: self.state.clone(),
            entry,
            name: options.name,
            ready,
        })
    }
    pub async fn close(&self) -> Result<()> {
        let mut task = self.task.lock().await;
        {
            let mut registry = self
                .state
                .bindings
                .lock()
                .map_err(|_| invalid("Listener host ownership failed"))?;
            if !registry.bindings.is_empty() {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Close every listener binding before closing its host",
                ));
            }
            registry.closing = true;
        }
        self.state.stop.cancel();
        if let Some(running) = task.as_mut() {
            running.await.map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Listener host task stopped unexpectedly",
                )
            })??;
        }
        *task = None;
        Ok(())
    }
}
impl<S: LocalState> Binding<S> {
    pub fn ready(&self) -> watch::Sender<Option<Arc<dyn ControlEndpoint>>> {
        self.ready.clone()
    }
    pub fn close(&self) -> Result<()> {
        let mut bindings = self
            .state
            .bindings
            .lock()
            .map_err(|_| invalid("Listener host ownership failed"))?;
        if bindings
            .bindings
            .get(&self.name)
            .is_none_or(|entry| !Arc::ptr_eq(entry, &self.entry))
        {
            return Ok(());
        }
        self.ready.send_replace(None);
        let saved: Option<Value> =
            local_state::read(self.state.storage.as_ref(), &self.entry.file, 65536)?;
        if saved.as_ref().is_some_and(|saved| {
            saved["binding"].as_str() != Some(&self.name)
                || saved["secret"].as_str() != Some(&self.entry.secret)
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Private listener metadata changed; replacement metadata was not removed",
            ));
        }
        self.state.storage.remove(&self.entry.file)?;
        bindings.bindings.remove(&self.name);
        Ok(())
    }
}
fn response(status: u16, value: Value) -> Result<Response<Body>> {
    let mut bytes = crossfire_kernel::bytes::Buffer::new(1048576);
    serde_json::to_writer(&mut bytes, &value)
        .map_err(|_| invalid("Listener reply exceeds its resource bound"))?;
    let mut reply = Response::new(server::full(bytes.into_vec()));
    *reply.status_mut() = server::StatusCode::from_u16(status)
        .map_err(|_| invalid("Invalid listener reply status"))?;
    reply.headers_mut().insert(
        server::header::CONTENT_TYPE,
        server::header::HeaderValue::from_static("application/json"),
    );
    reply.headers_mut().insert(
        server::header::CONNECTION,
        server::header::HeaderValue::from_static("close"),
    );
    reply.headers_mut().insert(
        server::header::CACHE_CONTROL,
        server::header::HeaderValue::from_static("no-store"),
    );
    reply.headers_mut().insert(
        server::header::X_CONTENT_TYPE_OPTIONS,
        server::header::HeaderValue::from_static("nosniff"),
    );
    Ok(reply)
}
fn forbidden() -> Result<Response<Body>> {
    let mut response = response(403, json!({}))?;
    *response.body_mut() = server::empty();
    Ok(response)
}
fn outcome(value: Result<Value>) -> Value {
    match value {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    }
}
async fn handle<S: LocalState>(
    state: Arc<State<S>>,
    request: Request<Incoming>,
    peer: Peer,
) -> Result<Response<Body>> {
    if !matches!(peer, Peer::Tcp(peer) if peer.ip().is_loopback())
        || state.stop.is_cancelled()
        || request.method() != server::Method::POST
        || request.headers().contains_key(server::header::ORIGIN)
        || request.uri().query().is_some()
    {
        return forbidden();
    }
    let path = request.uri().path().split('/').collect::<Vec<_>>();
    let name = match path.as_slice() {
        ["", "bindings", name, "control"] if valid_name(name) => (*name).to_owned(),
        _ => return forbidden(),
    };
    let entry = state
        .bindings
        .lock()
        .map_err(|_| invalid("Listener host ownership failed"))?
        .bindings
        .get(&name)
        .cloned();
    let Some(entry) = entry else {
        return forbidden();
    };
    let token = request
        .headers()
        .get(server::header::AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "))
        .unwrap_or("");
    if token.len() != 64
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || !bool::from(token.as_bytes().ct_eq(entry.secret.as_bytes()))
    {
        return forbidden();
    }
    let Ok(_permit) = state.requests.clone().try_acquire_owned() else {
        return response(
            429,
            json!({"error":"Listener host request capacity reached"}),
        );
    };
    let value = match server::json(request.into_body(), 65536).await {
        Ok(value) => value,
        Err(error) => return response(400, json!({"error":error.message})),
    };
    let action = match value.get("action").and_then(Value::as_str) {
        Some(action @ ("read" | "acknowledge" | "status" | "stop" | "test")) => action,
        _ => return response(400, json!({"error":"Invalid listener action"})),
    };
    let required: &[&str] = match action {
        "read" => &["action", "input"],
        "acknowledge" => &["action", "queryId"],
        _ => &["action"],
    };
    if let Err(error) = check::object(&value, required, &[]) {
        return response(400, json!({"error":error.message}));
    }
    let endpoint = entry.ready.borrow().clone();
    if matches!(action, "read" | "acknowledge") {
        let result = match endpoint {
            None => Err(Failure::new(
                ErrorCode::Unavailable,
                "Listener is not ready",
            )),
            Some(endpoint) if action == "read" => {
                endpoint
                    .read(value["input"].clone(), entry.stop.child_token())
                    .await
            }
            Some(endpoint) => match check::text(&value["queryId"], 1, 255) {
                Ok(query) => {
                    endpoint
                        .acknowledge(query.to_owned(), entry.stop.child_token())
                        .await
                }
                Err(error) => Err(error),
            },
        };
        return response(if result.is_ok() { 200 } else { 409 }, outcome(result));
    }
    let mut status = json!({"release":entry.release,"binding":name,"session":endpoint.as_ref().map(|endpoint| endpoint.session()).unwrap_or(""),"ready":endpoint.is_some()});
    if action == "stop" {
        entry.stop.cancel();
    }
    if action == "test" {
        let Some(endpoint) = endpoint else {
            return response(400, json!({"error":"Listener is not ready"}));
        };
        match endpoint.test(entry.stop.child_token()).await {
            Ok(value) => status["test"] = value,
            Err(error) => return response(400, json!({"error":error.message})),
        }
    }
    response(200, status)
}
