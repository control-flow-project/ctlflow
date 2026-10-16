use crossfire_agent_core::{
    coordination::Coordination, listener_control::Binding, listener_reporting::Activity,
    local_state::LocalState,
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use fleetd_adapter_execution::fleet_reports::Reports;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Notify, Semaphore, watch};
use tokio_util::sync::CancellationToken;
const FLEET: &str = "00000000-0000-4000-8000-000000000000";
const AGENT: &str = "00000000-0000-4000-8000-000000000001";
const RUN: &str = "00000000-0000-4000-8000-000000000002";
const NEXT: &str = "00000000-0000-4000-8000-000000000003";
fn failed() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Explicit fixture transport failure")
}
struct Storage {
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    changed: watch::Sender<usize>,
}
impl Storage {
    fn new() -> Self {
        Self {
            files: Mutex::default(),
            changed: watch::channel(usize::MAX).0,
        }
    }
}
impl LocalState for Storage {
    fn read(&self, file: &str, _maximum: usize) -> Result<Option<Vec<u8>>> {
        Ok(self.files.lock().map_err(|_| failed())?.get(file).cloned())
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        assert!(bytes.len() <= maximum);
        self.files
            .lock()
            .map_err(|_| failed())?
            .insert(file.into(), bytes.into());
        self.changed.send_replace(
            serde_json::from_slice::<Vec<Value>>(bytes)
                .map_err(|_| failed())?
                .len(),
        );
        Ok(())
    }
    fn remove(&self, file: &str) -> Result<()> {
        self.files.lock().map_err(|_| failed())?.remove(file);
        Ok(())
    }
}
struct Network {
    calls: Mutex<Vec<Value>>,
    reject: AtomicBool,
    hold: AtomicBool,
    entered: Notify,
    release: Semaphore,
}
impl Network {
    fn new() -> Self {
        Self {
            calls: Mutex::default(),
            reject: AtomicBool::new(false),
            hold: AtomicBool::new(false),
            entered: Notify::new(),
            release: Semaphore::new(0),
        }
    }
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "https://crossfire.invalid"
    }
    async fn call(&self, input: &Call, _stop: CancellationToken) -> Result<Value> {
        input.path_parts()?;
        assert!(matches!(
            input.operation,
            OperationId::ReportFleetFailure | OperationId::RecordFleetNativeStop
        ));
        self.calls
            .lock()
            .map_err(|_| failed())?
            .push(input.body.clone().ok_or_else(failed)?);
        self.entered.notify_one();
        if self.hold.swap(false, Ordering::SeqCst) {
            self.release.acquire().await.map_err(|_| failed())?.forget();
        }
        if self.reject.load(Ordering::SeqCst) {
            return Err(failed());
        }
        Ok(json!({"recorded":true}))
    }
}
fn binding(connection: &str) -> Binding {
    Binding {
        fleet_id: FLEET.into(),
        connection_id: connection.into(),
        credential: Secret::new("fixture-controller-secret".into()),
    }
}
#[tokio::test]
async fn failure_episodes_are_durable_bounded_and_retry_after_controller_restart()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Storage::new());
    let network = Arc::new(Network::new());
    network.reject.store(true, Ordering::SeqCst);
    let reports = Reports::open(
        storage.clone(),
        network.clone(),
        FLEET,
        "failures.json",
        CancellationToken::new(),
    )?;
    reports.failure(
        AGENT,
        Some("saved"),
        &Failure::new(ErrorCode::Unavailable, "🚀".repeat(2000)),
    )?;
    reports.failure(AGENT, Some("saved"), &failed())?;
    assert_eq!(
        *storage.changed.borrow(),
        1,
        "One outage is one durable episode"
    );
    let before = storage
        .read("failures.json", 33554432)?
        .ok_or("Saved failures")?;
    let retained: Vec<Value> = serde_json::from_slice(&before)?;
    assert_eq!(retained[0]["message"], "🚀".repeat(1000));
    reports.start().await?;
    tokio::time::timeout(Duration::from_secs(2), network.entered.notified()).await?;
    reports.close().await?;
    assert_eq!(
        storage
            .read("failures.json", 33554432)?
            .ok_or("Retained failures")?,
        before
    );
    let recovered = Arc::new(Network::new());
    let reports = Reports::open(
        storage.clone(),
        recovered.clone(),
        FLEET,
        "failures.json",
        CancellationToken::new(),
    )?;
    let mut written = storage.changed.subscribe();
    reports.start().await?;
    tokio::time::timeout(
        Duration::from_secs(2),
        written.wait_for(|count| *count == 0),
    )
    .await??;
    assert_eq!(recovered.calls.lock().map_err(|_| failed())?.len(), 1);
    reports.close().await?;
    Ok(())
}
#[tokio::test]
async fn native_stop_requires_the_same_authenticated_generation_before_and_after_http()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Storage::new());
    let network = Arc::new(Network::new());
    let reports = Reports::open(
        storage,
        network.clone(),
        FLEET,
        "failures.json",
        CancellationToken::new(),
    )?;
    let current = Arc::new(Mutex::new(binding(FLEET)));
    let observed = current.clone();
    reports.closed(
        AGENT,
        Activity {
            run_id: RUN.into(),
            binding: binding(FLEET),
        },
        Arc::new(move || Ok(observed.lock().map_err(|_| failed())?.clone())),
    )?;
    network.hold.store(true, Ordering::SeqCst);
    let owner = reports.clone();
    let checking =
        tokio::spawn(async move { owner.confirm(AGENT, CancellationToken::new()).await });
    tokio::time::timeout(Duration::from_secs(2), network.entered.notified()).await?;
    *current.lock().map_err(|_| failed())? = binding(NEXT);
    network.release.add_permits(1);
    assert_eq!(
        checking.await?.err().map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    assert!(
        reports
            .confirm(AGENT, CancellationToken::new())
            .await
            .is_err()
    );
    assert_eq!(network.calls.lock().map_err(|_| failed())?.len(), 1);
    let observed = current.clone();
    reports.closed(
        AGENT,
        Activity {
            run_id: RUN.into(),
            binding: binding(NEXT),
        },
        Arc::new(move || Ok(observed.lock().map_err(|_| failed())?.clone())),
    )?;
    reports.confirm(AGENT, CancellationToken::new()).await?;
    reports.confirm(AGENT, CancellationToken::new()).await?;
    assert_eq!(
        network.calls.lock().map_err(|_| failed())?.len(),
        2,
        "A proved close receipt is not sent twice"
    );
    assert!(reports.error()?.is_none());
    Ok(())
}
