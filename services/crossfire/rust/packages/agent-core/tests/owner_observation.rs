use crossfire_adapter_matrix::{
    agent::Client,
    protocol::{Protocol, Request, Response},
};
mod support;
use crossfire_agent_core::{
    coordination::Coordination,
    local_state::LocalState,
    owner_observation::{Observer, Options},
    profile,
    runtime::ObservationEvent,
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_domain::runtime::values::{HistoryMode, Runtime, State};
use crossfire_kernel::{Result, time::Clock};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicI64, Ordering},
};
use support::{Memory, failure};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

struct Time(Arc<AtomicI64>);
impl Clock for Time {
    fn now(&self) -> Result<i64> {
        Ok(self.0.load(Ordering::Acquire))
    }
}
struct Network {
    sent: Mutex<Vec<(String, Value)>>,
    observations: Mutex<Vec<Value>>,
    fail: AtomicBool,
    extra_member: AtomicBool,
}
impl Network {
    fn new() -> Self {
        Self {
            sent: Mutex::new(Vec::new()),
            observations: Mutex::new(Vec::new()),
            fail: AtomicBool::new(false),
            extra_member: AtomicBool::new(false),
        }
    }
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "https://app.example"
    }
    async fn call(&self, call: &Call, _stop: CancellationToken) -> Result<Value> {
        match call.operation {
            OperationId::ReportRuntime => {
                self.observations
                    .lock()
                    .map_err(|_| failure())?
                    .push(call.body.clone().ok_or_else(failure)?);
                Ok(json!({"accepted":true}))
            }
            OperationId::OwnerConversation => Ok(json!({"roomId":"!private:local"})),
            OperationId::DeliveryPolicy => Ok(
                json!({"agentId":"00000000-0000-4000-8000-000000000000","backendUserId":"@agent:local","ownerBackendUserId":"@owner:local","maxMessageBytes":65536,"fleetIdleTimeoutSeconds":1800,"status":"active","ownerStatus":"active","ownerConversation":"!private:local","roomGrants":[{"roomId":"!private:local","accessMode":"reply","nativeAccess":null,"muted":false}],"wakeMode":"selected","senderBackendUserIds":["@owner:local"]}),
            ),
            _ => Err(failure()),
        }
    }
}
impl Protocol for Network {
    async fn request(&self, request: &Request, _stop: CancellationToken) -> Result<Response> {
        if request.path.ends_with("/state") {
            let mut state = vec![
                json!({"sender":"@owner:local","type":"m.room.create","state_key":"","content":{"room_version":"11"}}),
                json!({"sender":"@owner:local","type":"m.room.join_rules","state_key":"","content":{"join_rule":"invite"}}),
            ];
            for member in ["@owner:local", "@agent:local"] {
                state.push(json!({"sender":member,"type":"m.room.member","state_key":member,"content":{"membership":"join"}}));
            }
            if self.extra_member.load(Ordering::Acquire) {
                state.push(json!({"sender":"@foreign:local","type":"m.room.member","state_key":"@foreign:local","content":{"membership":"join"}}));
            }
            return Ok(Response {
                status: 200,
                body: json!(state),
            });
        }
        self.sent.lock().map_err(|_| failure())?.push((
            request.path.clone(),
            request.body.clone().ok_or_else(failure)?,
        ));
        if self.fail.swap(false, Ordering::AcqRel) {
            return Err(failure());
        }
        Ok(Response {
            status: 200,
            body: json!({"event_id":"$sent"}),
        })
    }
}
fn options() -> Result<Options> {
    Ok(Options {
        profile: profile::parse(
            &json!({"id":"00000000-0000-4000-8000-000000000000","workspace":"/private/workarea","account":{"userId":"@agent:local","accessToken":"private-test-token","native":{"deviceId":"NATIVE"}},"settings":{"instance":"analyst","server":"https://app.example","backend":{"type":"matrix","parameters":{"origin":"https://app.example","serverName":"local"}},"owner":"@owner:local","maxUploadBytes":16777216}}),
        )?,
        file: "observation".to_owned(),
        history_mode: HistoryMode::Shared,
    })
}
fn working() -> ObservationEvent {
    ObservationEvent::State {
        runtime: Runtime::Codex,
        session_id: "saved".to_owned(),
        room_id: None,
        state: State::Working,
        observed_at: 1,
        settings: Vec::new(),
        error_message: None,
    }
}
#[tokio::test]
async fn terminal_output_is_private_chunked_and_retries_the_same_native_transaction_without_reasoning_or_room_fanout()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Memory::default());
    let network = Arc::new(Network::new());
    let (_reporting, ready) =
        watch::channel(Some("00000000-0000-4000-8000-000000000001".to_owned()));
    let observer = Observer::open(
        storage.clone(),
        network.clone(),
        Arc::new(Client::from_protocol(network.clone(), "@agent:local")?),
        Time(Arc::new(AtomicI64::new(1))),
        options()?,
        ready,
    )?;
    let text = "é".repeat(16000);
    observer.observe(
        ObservationEvent::Output {
            session_id: "saved".to_owned(),
            id: "output".to_owned(),
            stream_id: None,
            text: text.clone(),
        },
        65536,
        None,
    )?;
    network.fail.store(true, Ordering::Release);
    assert!(observer.flush(CancellationToken::new()).await.is_err());
    observer.flush(CancellationToken::new()).await?;
    let sent = network.sent.lock().map_err(|_| failure())?;
    assert_eq!(sent[0].0, sent[1].0);
    assert!(sent.iter().all(|(path, value)| {
        path.contains("!private")
            && value["body"]
                .as_str()
                .is_some_and(crossfire_adapter_matrix::notices::fits)
            && value["org.crossfire.listener_notice"] == true
    }));
    assert_eq!(
        sent.iter()
            .skip(1)
            .filter_map(|(_, value)| value["body"].as_str())
            .collect::<String>(),
        text
    );
    let journal: Value = serde_json::from_slice(
        &storage
            .read("observation", 64 * 1024 * 1024)?
            .ok_or("journal required")?,
    )?;
    assert_eq!(journal["output"], json!([]));
    Ok(())
}
#[tokio::test]
async fn room_derived_terminal_output_is_not_sent_when_a_third_person_has_entered_the_owner_conversation()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Memory::default());
    let network = Arc::new(Network::new());
    network.extra_member.store(true, Ordering::Release);
    let (_, ready) = watch::channel(Some("00000000-0000-4000-8000-000000000001".to_owned()));
    let observer = Observer::open(
        storage.clone(),
        network.clone(),
        Arc::new(Client::from_protocol(network.clone(), "@agent:local")?),
        Time(Arc::new(AtomicI64::new(1))),
        options()?,
        ready,
    )?;
    observer.notice("original", "Private owner output")?;
    assert!(observer.flush(CancellationToken::new()).await.is_err());
    assert!(network.sent.lock().map_err(|_| failure())?.is_empty());
    let journal: Value = serde_json::from_slice(
        &storage
            .read("observation", 64 * 1024 * 1024)?
            .ok_or("journal required")?,
    )?;
    assert_eq!(journal["output"].as_array().map(Vec::len), Some(1));
    Ok(())
}
#[tokio::test]
async fn thinking_moves_to_only_the_latest_room_and_expires_after_thirty_seconds_without_renewing_on_heartbeats()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Memory::default());
    let network = Arc::new(Network::new());
    let time = Arc::new(AtomicI64::new(1));
    let (_, ready) = watch::channel(Some("00000000-0000-4000-8000-000000000001".to_owned()));
    let observer = Observer::open(
        storage,
        network.clone(),
        Arc::new(Client::from_protocol(network.clone(), "@agent:local")?),
        Time(time.clone()),
        options()?,
        ready,
    )?;
    observer.observe(working(), 65536, None)?;
    assert!(observer.busy()?);
    observer
        .delivered("!first:local", "saved", CancellationToken::new())
        .await?;
    observer
        .delivered("!second:local", "saved", CancellationToken::new())
        .await?;
    time.store(30001, Ordering::Release);
    observer.flush(CancellationToken::new()).await?;
    observer.flush(CancellationToken::new()).await?;
    let sent = network.sent.lock().map_err(|_| failure())?;
    assert_eq!(sent.len(), 4);
    assert_eq!(
        sent.iter()
            .map(|(_, value)| value["typing"].clone())
            .collect::<Vec<_>>(),
        vec![json!(true), json!(false), json!(true), json!(false)]
    );
    assert!(sent[3].0.contains("second"));
    assert_eq!(network.observations.lock().map_err(|_| failure())?.len(), 1);
    Ok(())
}
