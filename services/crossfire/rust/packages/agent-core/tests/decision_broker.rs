mod support;
use crossfire_agent_core::{
    coordination::Coordination,
    decision_broker::Broker,
    local_state::LocalState,
    matrix::{Matrix, Request, Response},
    profile::{Account, Profile, Settings},
    runtime::Decision,
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::{Result, secret::Secret, time::Clock};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use support::{Memory, failure};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

struct Storage {
    memory: Memory,
    writes: watch::Sender<usize>,
}
impl LocalState for Storage {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
        self.memory.read(file, maximum)
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        self.memory.write(file, bytes, maximum)?;
        self.writes.send_modify(|value| *value += 1);
        Ok(())
    }
    fn remove(&self, file: &str) -> Result<()> {
        self.memory.remove(file)
    }
}
#[derive(Default)]
struct Network {
    receipts: Mutex<Vec<Value>>,
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "http://localhost:3000"
    }
    async fn call(&self, call: &Call, _stop: CancellationToken) -> Result<Value> {
        if call.operation != OperationId::ReceiptRuntimeDecision {
            return Err(failure());
        }
        self.receipts
            .lock()
            .map_err(|_| failure())?
            .push(call.body.clone().ok_or_else(failure)?);
        Ok(json!({"accepted":true}))
    }
}
impl Matrix for Network {
    async fn request(&self, _request: &Request, _stop: CancellationToken) -> Result<Response> {
        Err(failure())
    }
}
struct Time;
impl Clock for Time {
    fn now(&self) -> Result<i64> {
        Ok(1)
    }
}
fn profile() -> Profile {
    Profile {
        id: "00000000-0000-4000-8000-000000000000".to_owned(),
        workspace: PathBuf::from("/private/workarea"),
        settings: Settings {
            instance: "analyst".to_owned(),
            homeserver: "http://localhost:3000".to_owned(),
            server_name: "local".to_owned(),
            owner: "@owner:local".to_owned(),
            max_upload_bytes: 1048576,
        },
        account: Account {
            user_id: "@agent:local".to_owned(),
            access_token: Secret::new("private".to_owned()),
            device_id: "device".to_owned(),
        },
    }
}
fn decision() -> Decision {
    Decision {
        runtime: Runtime::Codex,
        session_id: "saved".to_owned(),
        request_id: "native-request".to_owned(),
        action: "Review native scope".to_owned(),
        scope: json!({"command":"requires owner"}),
        choices: Vec::new(),
        turn_id: Some("turn".to_owned()),
        item_id: Some("item".to_owned()),
        blocking: Some(true),
        expires_ms: None,
        questions: None,
    }
}

#[tokio::test]
async fn aborting_a_native_question_future_cancels_its_durable_receipt_instead_of_leaving_the_agent_waiting_forever()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (writes, mut changed) = watch::channel(0);
    let storage = Arc::new(Storage {
        memory: Memory::default(),
        writes,
    });
    let network = Arc::new(Network::default());
    let (_reporting, ready) = watch::channel(None);
    let broker = Arc::new(Broker::open(
        storage.clone(),
        network.clone(),
        network.clone(),
        Time,
        profile(),
        "decisions",
        ready,
    )?);
    let selected = broker.clone();
    let task = tokio::spawn(async move {
        selected
            .request(&decision(), CancellationToken::new())
            .await
    });
    tokio::time::timeout(
        Duration::from_secs(1),
        changed.wait_for(|writes| *writes >= 2),
    )
    .await??;
    assert!(broker.unresolved()?);
    task.abort();
    assert!(task.await.err().is_some_and(|error| error.is_cancelled()));
    assert!(!broker.unresolved()?);
    let receipts: Value = serde_json::from_slice(
        &storage
            .read("decisions", 1048576)?
            .ok_or("receipt required")?,
    )?;
    assert_eq!(receipts[0]["status"], "cancelled");
    broker.flush(CancellationToken::new()).await?;
    assert_eq!(
        network.receipts.lock().map_err(|_| failure())?[0]["status"],
        "cancelled"
    );
    Ok(())
}
#[tokio::test]
async fn decisions_without_the_native_turn_and_item_are_rejected_before_any_question_is_created()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (writes, _) = watch::channel(0);
    let storage = Arc::new(Storage {
        memory: Memory::default(),
        writes,
    });
    let network = Arc::new(Network::default());
    let (_, ready) = watch::channel(None);
    let broker = Broker::open(
        storage,
        network.clone(),
        network,
        Time,
        profile(),
        "decisions",
        ready,
    )?;
    let mut input = decision();
    input.turn_id = None;
    assert!(
        broker
            .request(&input, CancellationToken::new())
            .await
            .is_err()
    );
    assert!(!broker.unresolved()?);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn decision_expiry_includes_waiting_for_listener_registration_and_never_leaves_a_pending_native_question()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let (writes, _) = watch::channel(0);
    let storage = Arc::new(Storage {
        memory: Memory::default(),
        writes,
    });
    let network = Arc::new(Network::default());
    let (_reporting, ready) = watch::channel(None);
    let broker = Arc::new(Broker::open(
        storage,
        network.clone(),
        network,
        Time,
        profile(),
        "decisions",
        ready,
    )?);
    let mut input = decision();
    input.expires_ms = Some(5000);
    let selected = broker.clone();
    let task =
        tokio::spawn(async move { selected.request(&input, CancellationToken::new()).await });
    tokio::time::advance(Duration::from_secs(5)).await;
    assert!(task.await?.is_err());
    assert!(!broker.unresolved()?);
    broker.close(CancellationToken::new()).await?;
    assert!(
        broker
            .request(&decision(), CancellationToken::new())
            .await
            .is_err()
    );
    Ok(())
}
