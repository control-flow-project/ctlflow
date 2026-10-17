mod support;
use crossfire_agent_core::{
    controller_input::Acknowledgment,
    coordination::Coordination,
    listener::{self, Factory, Options, Resources},
    listener_budget::Budget,
    listener_control::{Binding, Control},
    listener_hooks::ListenerHooks,
    matrix::{Matrix, Request, Response},
    profile,
    runtime::{
        Admission, Approval, Connection, Hooks, InputPriority, InterruptResult, Lifecycle,
        ObservationEvent, Phase, SessionState, TurnControl,
    },
};
use crossfire_contracts::{call::Call, operations::OperationId, release::ARTIFACTS};
use crossfire_domain::runtime::values::{HistoryMode, Runtime, State};
use crossfire_kernel::{Result, secret::Secret};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;
use support::{Memory, failure};
use tokio::sync::{Mutex as AsyncMutex, mpsc, watch};
use tokio_util::sync::CancellationToken;

const AGENT: &str = "00000000-0000-4000-8000-000000000000";
const RELEASE: &str = "0.1.20-000000000000000000000000";
fn now() -> Result<i64> {
    Ok(1000)
}
type NativeHooks = ListenerHooks<Memory, Network, Network, fn() -> Result<i64>>;
fn event(mention: bool) -> Value {
    json!({"event_id":if mention {"$mention"} else {"$initial"},"type":"m.room.message","sender":"@owner:local","origin_server_ts":1,"content":{"msgtype":"m.text","body":if mention {"new steering instruction"} else {"slow original request"},"m.mentions":{"user_ids":if mention {vec!["@agent:local"]} else {Vec::new()}}}})
}
struct Network {
    events: AsyncMutex<mpsc::Receiver<Value>>,
    notices: Mutex<Vec<Value>>,
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "http://localhost:3000"
    }
    async fn call(&self, call: &Call, _stop: CancellationToken) -> Result<Value> {
        match call.operation {
            OperationId::Release => Ok(
                json!({"release":RELEASE,"version":"0.1.20","artifacts":ARTIFACTS.into_iter().map(|name| (name.to_owned(),json!({"bytes":1,"sha256":"0".repeat(64)}))).collect::<serde_json::Map<_,_>>()}),
            ),
            OperationId::ReportListener => {
                Ok(json!({"disconnect":false,"currentRelease":RELEASE,"statisticsAccepted":true}))
            }
            OperationId::ReportRuntime => Ok(json!({"accepted":true})),
            OperationId::DeliveryPolicy => Ok(
                json!({"agentId":AGENT,"matrixUserId":"@agent:local","ownerMatrixId":"@owner:local","maxMessageBytes":65536,"fleetIdleTimeoutSeconds":1800,"status":"active","ownerStatus":"active","ownerConversation":"!private:local","roomGrants":[{"roomId":"!room:local","accessMode":"reply","powerLevel":null,"muted":false},{"roomId":"!private:local","accessMode":"reply","powerLevel":null,"muted":false}],"wakeMode":"selected","senderMatrixIds":["@owner:local"]}),
            ),
            OperationId::ResolvePrincipals => Ok(
                json!([{"matrixUserId":"@owner:local","kind":"human","ownerMatrixId":null,"displayName":"Owner","ownerDisplayName":null}]),
            ),
            OperationId::OwnerConversation => Ok(json!({"roomId":"!private:local"})),
            OperationId::WakeMetadata => Ok(json!({"now":1000,"nextDueAt":null})),
            OperationId::ReceiptRuntimeDecision => Ok(json!({"accepted":true})),
            _ => Err(crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Invalid,
                format!("Unexpected coordination operation {:?}", call.operation),
            )),
        }
    }
}
impl Acknowledgment for Network {
    async fn acknowledge(
        &self,
        _message: &str,
        _status: &str,
        _error: Option<&str>,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
}
impl Matrix for Network {
    async fn request(&self, request: &Request, stop: CancellationToken) -> Result<Response> {
        let path = &request.path;
        let body = if path.ends_with("/sync") {
            if request.query.contains_key("since") {
                let mut events = self.events.lock().await;
                let event = tokio::select! { biased; _ = stop.cancelled() => return Err(failure()), event = events.recv() => event.ok_or_else(failure)? };
                json!({"next_batch":"s1","rooms":{"join":{"!room:local":{"timeline":{"limited":false,"events":[event]}}}}})
            } else {
                json!({"next_batch":"s0","rooms":{}})
            }
        } else if path.ends_with("/joined_rooms") {
            json!({"joined_rooms":["!room:local","!private:local"]})
        } else if path.ends_with("/joined_members") {
            json!({"joined":{"@owner:local":{},"@agent:local":{}}})
        } else if path.ends_with("/account_data/m.direct") {
            json!({})
        } else if path.ends_with("/state") {
            json!([{"type":"m.room.create","sender":"@owner:local","state_key":"","content":{"room_version":"11"}},{"type":"m.room.join_rules","sender":"@owner:local","state_key":"","content":{"join_rule":"invite"}},{"type":"m.room.member","sender":"@owner:local","state_key":"@owner:local","content":{"membership":"join"}},{"type":"m.room.member","sender":"@agent:local","state_key":"@agent:local","content":{"membership":"join"}}])
        } else if path.ends_with("/messages") {
            if path.contains("private") {
                json!({"chunk":[]})
            } else if !request.query.contains_key("from") {
                json!({"chunk":[event(false)],"end":"head"})
            } else {
                json!({"chunk":[],"end":"head"})
            }
        } else if path.contains("/event/") {
            event(true)
        } else if path.contains("/send/m.room.message/") {
            self.notices
                .lock()
                .map_err(|_| failure())?
                .push(request.body.clone().ok_or_else(failure)?);
            json!({"event_id":"$sent"})
        } else if path.ends_with("/read_markers") || path.contains("/typing/") {
            json!({})
        } else {
            return Err(crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Invalid,
                format!("Unexpected Matrix operation {}", request.path),
            ));
        };
        Ok(Response { status: 200, body })
    }
}
struct NativeState {
    inputs: Mutex<Vec<(String, String, Option<InputPriority>)>>,
    ordinary: watch::Sender<bool>,
    steering: watch::Sender<bool>,
    interrupted: AtomicUsize,
    busy: AtomicBool,
    wait_receipt: bool,
}
struct Native {
    hooks: Arc<NativeHooks>,
    state: Arc<NativeState>,
    lifetime: CancellationToken,
}
impl Connection for Native {
    fn session_id(&self) -> &str {
        "saved-native-history"
    }
    fn approval(&self) -> Approval {
        Approval::None
    }
    fn lifetime(&self) -> CancellationToken {
        self.lifetime.clone()
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(self.state.busy.load(Ordering::Acquire))
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        stop: CancellationToken,
        priority: Option<InputPriority>,
    ) -> Result<()> {
        self.state.inputs.lock().map_err(|_| failure())?.push((
            message.to_owned(),
            text.to_owned(),
            priority,
        ));
        self.state.busy.store(true, Ordering::Release);
        self.hooks.observe(ObservationEvent::State {
            runtime: Runtime::Codex,
            session_id: self.session_id().to_owned(),
            room_id: None,
            state: State::Working,
            observed_at: 1000,
            settings: Vec::new(),
            error_message: None,
        });
        if priority.is_some() {
            self.state.steering.send_replace(true);
            Ok(())
        } else {
            self.state.ordinary.send_replace(true);
            if !self.state.wait_receipt {
                return Ok(());
            }
            stop.cancelled().await;
            Err(failure())
        }
    }
    async fn settle(&self, _stop: CancellationToken) -> Result<bool> {
        Ok(false)
    }
    async fn recover(&self, text: &str, message: &str, _stop: CancellationToken) -> Result<bool> {
        Ok(self
            .state
            .inputs
            .lock()
            .map_err(|_| failure())?
            .iter()
            .any(|(id, received, _)| id == message && received == text))
    }
    fn acknowledge(&self, _messages: &[String]) -> Result<()> {
        Ok(())
    }
    async fn conversation(&self, _room: &str, _admission: Option<&Admission>) -> Result<Self> {
        Ok(Self {
            hooks: self.hooks.clone(),
            state: self.state.clone(),
            lifetime: self.lifetime.clone(),
        })
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
impl Lifecycle for Native {
    fn current(&self) -> Result<SessionState> {
        Ok(SessionState {
            phase: Phase::Running,
            last_activity_at: Some(1000),
            history_available: true,
        })
    }
    fn configure_idle(&self, _seconds: i64) -> Result<()> {
        Ok(())
    }
}
impl TurnControl for Native {
    async fn active_turn(
        &self,
        _room: Option<&str>,
        _admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        Ok(self
            .state
            .busy
            .load(Ordering::Acquire)
            .then(|| "captured-turn".to_owned()))
    }
    async fn interrupt(
        &self,
        turn: &str,
        _recovery: bool,
        _admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        if turn != "captured-turn" {
            return Err(failure());
        }
        self.state.interrupted.fetch_add(1, Ordering::AcqRel);
        self.state.busy.store(false, Ordering::Release);
        Ok(InterruptResult::Interrupted)
    }
}
struct RuntimeFactory(Arc<NativeState>);
impl Factory<NativeHooks> for RuntimeFactory {
    type Native = Native;
    async fn start(&self, hooks: Arc<NativeHooks>, stop: CancellationToken) -> Result<Native> {
        Ok(Native {
            hooks,
            state: self.0.clone(),
            lifetime: stop,
        })
    }
}
#[tokio::test]
async fn accepted_mentions_interrupt_before_waiting_for_the_ordinary_native_receipt_and_submit_only_the_steering_event()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    verify(false).await
}
#[tokio::test]
async fn accepted_mentions_retire_prepared_unread_queries_without_a_five_minute_delivery_delay()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    verify(true).await
}
async fn verify(prepared_query: bool) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (events, received) = mpsc::channel(2);
    let network = Arc::new(Network {
        events: AsyncMutex::new(received),
        notices: Mutex::new(Vec::new()),
    });
    let (ordinary, mut first) = watch::channel(false);
    let (steering, mut next) = watch::channel(false);
    let state = Arc::new(NativeState {
        inputs: Mutex::new(Vec::new()),
        ordinary,
        steering,
        interrupted: AtomicUsize::new(0),
        busy: AtomicBool::new(false),
        wait_receipt: !prepared_query,
    });
    let binding = Binding {
        fleet_id: "00000000-0000-4000-8000-000000000001".to_owned(),
        connection_id: "00000000-0000-4000-8000-000000000002".to_owned(),
        credential: Secret::new("private".to_owned()),
    };
    let control = Arc::new(Control::new(binding.clone())?);
    control.update(true, true, None, binding)?;
    let options = Options {
        profile: profile::parse(
            &json!({"id":AGENT,"workspace":"/private/workarea","account":{"user_id":"@agent:local","access_token":"private","device_id":"NATIVE"},"settings":{"instance":"analyst","homeserver":"http://localhost:3000","server_name":"local","owner":"@owner:local","max_upload_bytes":16777216}}),
        )?,
        file: "receive".to_owned(),
        release: RELEASE.to_owned(),
        history_mode: HistoryMode::Shared,
        room: None,
        limit: 100,
        poll_ms: 100,
        debounce_ms: 0,
        reconcile_ms: 1000,
    };
    let storage = Arc::new(Memory::default());
    let (ready, mut endpoint) = watch::channel(None);
    let resources = Resources {
        storage: storage.clone(),
        coordination: network.clone(),
        matrix: network.clone(),
        acknowledgment: network,
        control,
        budget: Arc::new(Budget::default()),
        clock: now as fn() -> Result<i64>,
        ready: Some(ready),
        diagnostic: Arc::new(|error| eprintln!("{}: {}", error.code.as_str(), error.message)),
    };
    let stop = CancellationToken::new();
    let selected = stop.clone();
    let native = state.clone();
    let task = tokio::spawn(async move {
        listener::run(resources, RuntimeFactory(native), options, selected).await
    });
    tokio::time::timeout(Duration::from_secs(3), first.wait_for(|first| *first)).await??;
    if prepared_query {
        let endpoint = tokio::time::timeout(
            Duration::from_secs(3),
            endpoint.wait_for(|endpoint| endpoint.is_some()),
        )
        .await??
        .as_ref()
        .cloned()
        .ok_or("Ready endpoint")?;
        tokio::time::timeout(Duration::from_secs(3),async {
            loop {
                match endpoint.read(json!({"kind":"unread","limit":100,"outputBytes":65536,"direction":"f","cursors":{"entries":[]}}),CancellationToken::new()).await {
                    Ok(reply)=> { assert!(reply["queryId"].is_string()); return Ok::<_,crossfire_kernel::Failure>(()); },
                    Err(error) if error.code==crossfire_kernel::failure::ErrorCode::Conflict && error.message.starts_with("Settle the current")=>tokio::task::yield_now().await,
                    Err(error)=>return Err(error),
                }
            }
        }).await??;
    }
    events.send(event(true)).await?;
    tokio::time::timeout(Duration::from_secs(3), next.wait_for(|next| *next)).await??;
    assert_eq!(state.interrupted.load(Ordering::Acquire), 1);
    {
        let inputs = state.inputs.lock().map_err(|_| failure())?;
        assert_eq!(inputs.len(), 2);
        assert!(inputs[1].1.contains("new steering instruction"));
        assert!(!inputs[1].1.contains("slow original request"));
        assert_eq!(inputs[1].2, Some(InputPriority::Steering));
    }
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(3), task).await???;
    if prepared_query {
        use crossfire_agent_core::local_state::LocalState;
        assert!(
            storage.read("receive.query", 1048576)?.is_none(),
            "Prepared queries are superseded, not left blocking delivery until expiry"
        );
    }
    Ok(())
}
