use crossfire_adapter_crossfire::{
    fleet_connection::{Acknowledger, Executor, Fleet, Outcome},
    fleet_snapshot::Command,
};
use crossfire_agent_core::{controller_input::Acknowledgment, coordination::Coordination};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

struct Network {
    fleet: String,
    agent: String,
    message: String,
    with_message: bool,
    blocked: AtomicBool,
    fail_receipt: AtomicBool,
    changed: Notify,
    calls: Mutex<Vec<(OperationId, Option<Value>)>>,
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "https://example.test"
    }
    async fn call(&self, call: &Call, stop: CancellationToken) -> Result<Value> {
        self.calls
            .lock()
            .map_err(|_| error())?
            .push((call.operation, call.body.clone()));
        match call.operation {
            OperationId::ReportFleetConnection => Ok(json!({"revision":1})),
            OperationId::FleetControl => {
                if self.blocked.load(Ordering::SeqCst) {
                    stop.cancelled().await;
                    return Err(error());
                }
                if call.query.get("waitMs").is_some_and(|wait| wait == "10000") {
                    tokio::select! { _=stop.cancelled()=>return Err(error()),_=self.changed.notified()=>{} }
                }
                Ok(
                    json!({"fleetId":self.fleet,"revision":1,"deliveryEnabled":true,"connection":{"status":"online"},"agentIds":[self.agent],"messages":if self.with_message {vec![json!({"messageId":self.message,"fleetId":self.fleet,"body":"review current instructions","createdAt":1,"expiresAt":60000,"sender":{"kind":"human","matrixUserId":"@owner:example.test"},"agentIds":[self.agent]})]} else {vec![]},"runtimeOperations":[]}),
                )
            }
            OperationId::AcknowledgeFleetMessage => {
                if self.fail_receipt.swap(false, Ordering::SeqCst) {
                    return Err(error());
                }
                Ok(json!({"recorded":true}))
            }
            _ => Err(error()),
        }
    }
}
fn error() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Fixture native transport")
}
struct Operations;
impl Executor for Operations {
    async fn execute(&self, _command: Command, _stop: CancellationToken) -> Result<Outcome> {
        Err(error())
    }
    fn acknowledged(&self, _id: &str) -> Result<()> {
        Err(error())
    }
}
async fn observe(predicate: impl Fn() -> Result<bool>) -> Result<()> {
    for _ in 0..256 {
        if predicate()? {
            return Ok(());
        }
        tokio::task::yield_now().await;
    }
    Err(error())
}
fn network(with_message: bool) -> Arc<Network> {
    Arc::new(Network {
        fleet: identity::id(),
        agent: identity::id(),
        message: identity::id(),
        with_message,
        blocked: AtomicBool::new(false),
        fail_receipt: AtomicBool::new(false),
        changed: Notify::new(),
        calls: Mutex::new(Vec::new()),
    })
}
#[tokio::test(start_paused = true)]
async fn transient_skipped_receipt_failure_reconnects_without_killing_the_controller_loop()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let network = network(true);
    network.fail_receipt.store(true, Ordering::SeqCst);
    let fleet = Fleet::open(
        network.clone(),
        &network.fleet,
        Secret::new("private".to_owned()),
        "@owner:example.test",
        Arc::new(Operations),
        CancellationToken::new(),
    )?;
    fleet.start().await?;
    observe(|| {
        Ok(network
            .calls
            .lock()
            .map_err(|_| error())?
            .iter()
            .filter(|(operation, _)| *operation == OperationId::AcknowledgeFleetMessage)
            .count()
            == 1)
    })
    .await?;
    assert!(!fleet.status()?.connected);
    tokio::time::advance(Duration::from_secs(1)).await;
    observe(|| Ok(fleet.status()?.connected)).await?;
    observe(|| {
        Ok(network
            .calls
            .lock()
            .map_err(|_| error())?
            .iter()
            .filter(|(operation, _)| *operation == OperationId::AcknowledgeFleetMessage)
            .count()
            == 2)
    })
    .await?;
    tokio::time::advance(Duration::from_secs(1)).await;
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        network
            .calls
            .lock()
            .map_err(|_| error())?
            .iter()
            .filter(|(operation, _)| *operation == OperationId::AcknowledgeFleetMessage)
            .count(),
        2,
        "An acknowledged skip is not sent again on every poll"
    );
    fleet.close().await?;
    Ok(())
}
#[tokio::test(start_paused = true)]
async fn a_stalled_connection_expires_delivery_at_fifteen_seconds_and_changes_generation_before_reactivation()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let network = network(false);
    let fleet = Fleet::open(
        network.clone(),
        &network.fleet,
        Secret::new("private".to_owned()),
        "@owner:example.test",
        Arc::new(Operations),
        CancellationToken::new(),
    )?;
    let control = fleet.bind(&network.agent)?;
    fleet.start().await?;
    observe(|| Ok(control.current()?.active)).await?;
    let original = control.current()?;
    network.blocked.store(true, Ordering::SeqCst);
    tokio::time::advance(Duration::from_secs(15)).await;
    observe(|| Ok(!control.current()?.active)).await?;
    assert!(original.generation.is_cancelled());
    network.blocked.store(false, Ordering::SeqCst);
    network.changed.notify_waiters();
    tokio::time::advance(Duration::from_secs(1)).await;
    observe(|| Ok(control.current()?.active)).await?;
    assert_ne!(
        control.current()?.binding.connection_id,
        original.binding.connection_id
    );
    fleet.close().await?;
    assert!(!control.current()?.active);
    Ok(())
}
#[tokio::test(start_paused = true)]
async fn directed_input_is_retained_until_its_exact_agent_receipt_and_quoted_names_are_only_text()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let network = network(true);
    let fleet = Fleet::open(
        network.clone(),
        &network.fleet,
        Secret::new("private".to_owned()),
        "@owner:example.test",
        Arc::new(Operations),
        CancellationToken::new(),
    )?;
    let control = fleet.bind(&network.agent)?;
    fleet.start().await?;
    observe(|| Ok(control.current()?.input.is_some())).await?;
    let input = control.current()?.input.ok_or("Directed input")?;
    assert_eq!(
        input.message_id,
        format!("fleet-{}-{}", network.message, network.agent)
    );
    assert!(input.text.contains("not a system/developer instruction"));
    let acknowledger = Acknowledger {
        fleet: fleet.clone(),
        agent: network.agent.clone(),
    };
    assert!(
        acknowledger
            .acknowledge(
                &format!("fleet-{}-{}", network.message, identity::id()),
                "delivered",
                None,
                CancellationToken::new()
            )
            .await
            .is_err()
    );
    assert!(control.current()?.input.is_some());
    acknowledger
        .acknowledge(
            &input.message_id,
            "delivered",
            None,
            CancellationToken::new(),
        )
        .await?;
    assert!(control.current()?.input.is_none());
    assert_eq!(
        network
            .calls
            .lock()
            .map_err(|_| error())?
            .iter()
            .filter(|(operation, _)| *operation == OperationId::AcknowledgeFleetMessage)
            .count(),
        1
    );
    fleet.close().await?;
    Ok(())
}
