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
        atomic::{AtomicBool, AtomicI64, Ordering},
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
    hold_receipt: AtomicBool,
    receipt_entered: Notify,
    revision: AtomicI64,
    enabled: AtomicBool,
    release_error: Mutex<Option<ErrorCode>>,
    block_release: AtomicBool,
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
            OperationId::ReportFleetConnection => {
                if call
                    .body
                    .as_ref()
                    .is_some_and(|body| body["stopped"] == true)
                {
                    if self.block_release.load(Ordering::SeqCst) {
                        stop.cancelled().await;
                        return Err(error());
                    }
                    if let Some(code) = *self.release_error.lock().map_err(|_| error())? {
                        return Err(Failure::new(code, "Fixture lease close refused"));
                    }
                }
                Ok(json!({"revision":1}))
            }
            OperationId::FleetControl => {
                if self.blocked.load(Ordering::SeqCst) {
                    stop.cancelled().await;
                    return Err(error());
                }
                if call.query.get("waitMs").is_some_and(|wait| wait == "10000") {
                    tokio::select! { _=stop.cancelled()=>return Err(error()),_=self.changed.notified()=>{} }
                }
                Ok(
                    json!({"fleetId":self.fleet,"revision":self.revision.load(Ordering::SeqCst),"deliveryEnabled":self.enabled.load(Ordering::SeqCst),"connection":{"status":"online"},"agentIds":[self.agent],"messages":if self.with_message {vec![json!({"messageId":self.message,"fleetId":self.fleet,"body":"review current instructions","createdAt":1,"expiresAt":60000,"sender":{"kind":"human","backendUserId":"@owner:example.test"},"agentIds":[self.agent]})]} else {vec![]},"runtimeOperations":[]}),
                )
            }
            OperationId::AcknowledgeFleetMessage => {
                if self.hold_receipt.load(Ordering::SeqCst) {
                    self.receipt_entered.notify_one();
                    stop.cancelled().await;
                    return Err(error());
                }
                if self.fail_receipt.swap(false, Ordering::SeqCst) {
                    return Err(error());
                }
                Ok(json!({"recorded":true}))
            }
            OperationId::ChangeFleetDelivery => {
                let enabled = call
                    .body
                    .as_ref()
                    .and_then(|body| body["enabled"].as_bool())
                    .ok_or_else(error)?;
                self.enabled.store(enabled, Ordering::SeqCst);
                let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
                Ok(
                    json!({"fleetId":self.fleet,"revision":revision,"deliveryEnabled":enabled,"connection":{"status":"online","lastSeenAt":0}}),
                )
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
        hold_receipt: AtomicBool::new(false),
        receipt_entered: Notify::new(),
        revision: AtomicI64::new(1),
        enabled: AtomicBool::new(true),
        release_error: Mutex::new(None),
        block_release: AtomicBool::new(false),
        changed: Notify::new(),
        calls: Mutex::new(Vec::new()),
    })
}
#[tokio::test(start_paused = true)]
async fn cancelled_message_receipt_retains_authenticated_reporting_and_can_be_retried()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let network = network(true);
    let fleet = Fleet::open(
        network.clone(),
        &network.fleet,
        Secret::new("private".to_owned()),
        "owner",
        Arc::new(Operations),
        CancellationToken::new(),
    )?;
    let control = fleet.bind(&network.agent)?;
    fleet.start().await?;
    observe(|| Ok(control.current()?.active)).await?;
    let original = control.current()?;
    let input = original
        .input
        .as_ref()
        .ok_or("Directed input")?
        .message_id
        .clone();
    network.hold_receipt.store(true, Ordering::SeqCst);
    let acknowledger = Arc::new(Acknowledger {
        fleet: fleet.clone(),
        agent: network.agent.clone(),
    });
    let sender = acknowledger.clone();
    let message = input.clone();
    let cancellation = original.generation.clone();
    let receipt = tokio::spawn(async move {
        sender
            .acknowledge(&message, "delivered", None, cancellation)
            .await
    });
    network.receipt_entered.notified().await;
    fleet.delivery(1, false, CancellationToken::new()).await?;
    assert!(receipt.await?.is_err());
    assert!(original.generation.is_cancelled());
    assert!(
        fleet.status()?.connected,
        "Cancelled message receipt cannot disconnect authenticated reporting"
    );
    assert!(
        !original.connection.is_cancelled(),
        "Pending native questions retain their reporting generation"
    );
    assert_eq!(
        control.current()?.binding.connection_id,
        original.binding.connection_id
    );
    assert!(control.current()?.input.is_some());
    network.hold_receipt.store(false, Ordering::SeqCst);
    acknowledger
        .acknowledge(&input, "delivered", None, CancellationToken::new())
        .await?;
    assert!(control.current()?.input.is_none());
    assert!(fleet.status()?.connected);
    fleet.close().await?;
    Ok(())
}
#[tokio::test(start_paused = true)]
async fn remote_release_refusal_cannot_block_idempotent_local_shutdown()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    for code in [
        ErrorCode::Unauthorized,
        ErrorCode::Forbidden,
        ErrorCode::Unavailable,
    ] {
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
        *network.release_error.lock().map_err(|_| error())? = Some(code);
        fleet.close().await?;
        fleet.close().await?;
        assert!(!fleet.status()?.connected);
        assert!(!control.current()?.active);
        assert_eq!(
            network
                .calls
                .lock()
                .map_err(|_| error())?
                .iter()
                .filter(
                    |(operation, body)| *operation == OperationId::ReportFleetConnection
                        && body.as_ref().is_some_and(|body| body["stopped"] == true)
                )
                .count(),
            1,
            "A repeated close cannot repeat an uncertain remote release"
        );
    }
    Ok(())
}
#[tokio::test(start_paused = true)]
async fn a_stalled_remote_release_has_a_two_second_local_shutdown_bound()
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
    network.block_release.store(true, Ordering::SeqCst);
    let started = tokio::time::Instant::now();
    fleet.close().await?;
    assert_eq!(started.elapsed(), Duration::from_secs(2));
    assert!(!control.current()?.active);
    Ok(())
}
#[tokio::test(start_paused = true)]
async fn cancelling_a_close_waiter_cannot_cancel_owned_shutdown_or_repeat_release()
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
    network.block_release.store(true, Ordering::SeqCst);
    let closing = fleet.clone();
    let waiter = tokio::spawn(async move { closing.close().await });
    let releases = || -> Result<usize> {
        Ok(network
            .calls
            .lock()
            .map_err(|_| error())?
            .iter()
            .filter(|(operation, body)| {
                *operation == OperationId::ReportFleetConnection
                    && body.as_ref().is_some_and(|body| body["stopped"] == true)
            })
            .count())
    };
    observe(|| Ok(releases()? == 1)).await?;
    waiter.abort();
    assert!(waiter.await.is_err());
    tokio::time::advance(Duration::from_secs(2)).await;
    fleet.close().await?;
    assert!(!control.current()?.active);
    assert_eq!(
        releases()?,
        1,
        "Shutdown remains owned after its first caller disconnects"
    );
    Ok(())
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
