use crossfire_adapter_runtime::{
    clock::Clock,
    delivery::{Delivery, Publication, Receipt},
    journal::{Journal, NativeMessage, validate_message},
};
use crossfire_agent_core::runtime::Approval;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    text: String,
    message_id: String,
    published: bool,
}
impl NativeMessage for Message {
    fn text(&self) -> &str {
        &self.text
    }
    fn message_id(&self) -> &str {
        &self.message_id
    }
    fn validate(&self) -> Result<()> {
        validate_message(&self.text, &self.message_id)
    }
}

struct ControlledClock(Arc<AtomicU64>);
impl Clock for ControlledClock {
    fn now(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
    async fn wait(&self, milliseconds: u64, cancellation: CancellationToken) -> Result<()> {
        crossfire_adapter_runtime::clock::check(&cancellation)?;
        self.0.fetch_add(milliseconds, Ordering::SeqCst);
        Ok(())
    }
}

struct Native {
    file: PathBuf,
    receipts: Mutex<VecDeque<Receipt>>,
    lifetime: CancellationToken,
    published: AtomicUsize,
    restored: AtomicBool,
    uncertain: AtomicBool,
    cancelled: AtomicBool,
}
impl Publication<Message> for Arc<Native> {
    fn session_id(&self) -> &str {
        "session"
    }
    fn approval(&self) -> Approval {
        Approval::Runtime
    }
    fn lifetime(&self) -> CancellationToken {
        self.lifetime.clone()
    }
    async fn verify(&self, cancellation: CancellationToken) -> Result<()> {
        crossfire_adapter_runtime::clock::check(&cancellation)
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(false)
    }
    async fn prepare(
        &self,
        text: &str,
        message_id: &str,
        _cancellation: CancellationToken,
    ) -> Result<Message> {
        Ok(Message {
            text: text.to_owned(),
            message_id: message_id.to_owned(),
            published: false,
        })
    }
    async fn publish(&self, input: &Message, journal: &mut Journal<Message>) -> Result<()> {
        let saved = crossfire_adapter_runtime::journal::read::<Message>(&self.file, "session")?;
        assert_eq!(
            saved
                .pending
                .as_ref()
                .map(|value| value.message_id.as_str()),
            Some(input.message_id())
        );
        self.published.fetch_add(1, Ordering::SeqCst);
        if self.uncertain.load(Ordering::SeqCst) {
            return Err(Failure::new(
                ErrorCode::Native,
                "Fixture uncertain native write",
            ));
        }
        journal.prepare(Message {
            text: input.text.clone(),
            message_id: input.message_id.clone(),
            published: true,
        })
    }
    async fn received(
        &self,
        _input: &Message,
        _journal: &mut Journal<Message>,
        _cancellation: CancellationToken,
        restored: bool,
    ) -> Result<Receipt> {
        self.restored.store(restored, Ordering::SeqCst);
        Ok(self
            .receipts
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
            .pop_front()
            .unwrap_or(Receipt::Absent))
    }
    async fn cancel(&self, _input: &Message) -> Result<bool> {
        Ok(self.cancelled.load(Ordering::SeqCst))
    }
    async fn close(&self) -> Result<()> {
        self.lifetime.cancel();
        Ok(())
    }
}

fn native(file: PathBuf, receipts: Vec<Receipt>) -> Arc<Native> {
    Arc::new(Native {
        file,
        receipts: Mutex::new(receipts.into()),
        lifetime: CancellationToken::new(),
        published: AtomicUsize::new(0),
        restored: AtomicBool::new(false),
        uncertain: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
    })
}
fn open(
    native: Arc<Native>,
    file: &std::path::Path,
) -> Result<Delivery<Message, Arc<Native>, ControlledClock>> {
    Delivery::open(
        native,
        ControlledClock(Arc::new(AtomicU64::new(0))),
        file,
        100,
        300,
    )
}

#[tokio::test]
async fn accepted_input_is_durable_before_publish_and_confirmed_only_once()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let native = native(file.clone(), vec![Receipt::Absent, Receipt::Received]);
    let delivery = open(Arc::clone(&native), &file)?;
    delivery
        .deliver("request", "message", CancellationToken::new())
        .await?;
    delivery
        .deliver("request", "message", CancellationToken::new())
        .await?;
    assert_eq!(native.published.load(Ordering::SeqCst), 1);
    assert!(
        delivery
            .recover("request", "message", CancellationToken::new())
            .await?
    );
    assert!(
        delivery
            .recover("changed", "message", CancellationToken::new())
            .await
            .is_err()
    );
    assert!(delivery.unsettled()?);
    delivery.acknowledge(&["message".to_owned()])?;
    assert!(!delivery.unsettled()?);
    delivery.close().await?;
    Ok(())
}

#[tokio::test]
async fn uncertain_publication_survives_restart_without_resubmission()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let original = native(file.clone(), vec![]);
    original.uncertain.store(true, Ordering::SeqCst);
    let delivery = open(Arc::clone(&original), &file)?;
    assert!(
        delivery
            .deliver("request", "message", CancellationToken::new())
            .await
            .is_err()
    );
    assert_eq!(original.published.load(Ordering::SeqCst), 1);
    assert!(
        delivery
            .deliver("another", "other", CancellationToken::new())
            .await
            .is_err(),
        "No different input before receipt recovery"
    );
    delivery.close().await?;
    let restarted = native(file.clone(), vec![Receipt::Received]);
    let delivery = open(Arc::clone(&restarted), &file)?;
    assert!(
        delivery
            .recover("request", "message", CancellationToken::new())
            .await?
    );
    assert!(restarted.restored.load(Ordering::SeqCst));
    assert_eq!(
        restarted.published.load(Ordering::SeqCst),
        0,
        "Recovery never publishes the original again"
    );
    delivery.close().await?;
    Ok(())
}

#[tokio::test]
async fn receipt_deadline_preserves_evidence_and_waiting_extends_only_its_native_wait()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let native = native(file.clone(), vec![]);
    let delivery = open(Arc::clone(&native), &file)?;
    assert!(
        delivery
            .deliver("request", "message", CancellationToken::new())
            .await
            .is_err()
    );
    assert!(
        crossfire_adapter_runtime::journal::read::<Message>(&file, "session")?
            .pending
            .is_some()
    );
    assert_eq!(native.published.load(Ordering::SeqCst), 1);
    native
        .receipts
        .lock()
        .map_err(|_| "Fixture poisoned")?
        .extend([
            Receipt::Waiting,
            Receipt::Absent,
            Receipt::Waiting,
            Receipt::Absent,
            Receipt::Absent,
            Receipt::Received,
        ]);
    assert!(delivery.settle(CancellationToken::new()).await?);
    assert_eq!(native.published.load(Ordering::SeqCst), 1);
    delivery.close().await?;
    Ok(())
}

#[tokio::test]
async fn interrupted_before_receipt_retries_but_cancelled_before_receipt_does_not()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let native = native(
        file.clone(),
        vec![Receipt::Interrupted, Receipt::Received, Receipt::Cancelled],
    );
    let delivery = open(Arc::clone(&native), &file)?;
    delivery
        .deliver("request", "message", CancellationToken::new())
        .await?;
    assert_eq!(native.published.load(Ordering::SeqCst), 2);
    assert!(
        delivery
            .deliver("next", "other", CancellationToken::new())
            .await
            .is_err()
    );
    assert!(
        !delivery
            .recover("next", "other", CancellationToken::new())
            .await?
    );
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(delivery.deliver("never", "never", cancelled).await.is_err());
    assert_eq!(native.published.load(Ordering::SeqCst), 3);
    delivery.close().await?;
    Ok(())
}
