use crate::{
    artifacts::Store,
    chat::Artifacts,
    events::invalid,
    listener_control::{Control, Input},
    local_state::{self, LocalState},
    runtime::Connection,
};
use crossfire_kernel::{Result, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{future::Future, sync::Arc};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub trait Acknowledgment: Send + Sync {
    fn acknowledge(
        &self,
        message: &str,
        status: &str,
        error: Option<&str>,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Stage {
    Queued,
    Publishing,
    Delivered,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Saved {
    session_id: String,
    input: Input,
    text: String,
    stage: Stage,
}
pub struct Publisher<S, N, A, T> {
    pub storage: Arc<S>,
    pub native: Arc<N>,
    pub artifacts: Arc<Store<S, T>>,
    pub control: Arc<Control>,
    pub acknowledgment: Arc<A>,
    pub clock: T,
    pub file: String,
    owner: Mutex<()>,
}
impl<S: LocalState, N: Connection, A: Acknowledgment, T: Clock + Send + Sync>
    Publisher<S, N, A, T>
{
    pub fn new(
        storage: Arc<S>,
        native: Arc<N>,
        artifacts: Arc<Store<S, T>>,
        control: Arc<Control>,
        acknowledgment: Arc<A>,
        clock: T,
        file: String,
    ) -> Self {
        Self {
            storage,
            native,
            artifacts,
            control,
            acknowledgment,
            clock,
            file,
            owner: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<Option<Saved>> {
        let saved: Option<Saved> = local_state::read(self.storage.as_ref(), &self.file, 1048576)?;
        if let Some(saved) = &saved {
            saved.input.validate()?;
            if saved.session_id != self.native.session_id() || saved.text.len() > 98304 {
                return Err(invalid("Invalid or retargeted controller input checkpoint"));
            }
        }
        Ok(saved)
    }
    fn save(&self, saved: &Saved) -> Result<()> {
        local_state::write(self.storage.as_ref(), &self.file, saved, 1048576)
    }
    pub fn pending(&self) -> Result<bool> {
        Ok(self.load()?.is_some() || self.control.current()?.input.is_some())
    }
    pub async fn publish(&self, maximum: usize, stop: CancellationToken) -> Result<()> {
        let _owner = self.owner.lock().await;
        let mut saved = match self.load()? {
            Some(saved) => saved,
            None => {
                let Some(input) = self.control.current()?.input else {
                    return Ok(());
                };
                input.validate()?;
                let saved = Saved {
                    session_id: self.native.session_id().to_owned(),
                    text: self.artifacts.input(
                        input.text.clone(),
                        &input.message_id,
                        maximum,
                        &json!({"kind":"controller-input","expiresAt":input.expires_at}),
                    )?,
                    input,
                    stage: Stage::Queued,
                };
                self.save(&saved)?;
                saved
            }
        };
        if saved.stage == Stage::Publishing {
            saved.stage = if self
                .native
                .recover(&saved.text, &saved.input.message_id, stop.clone())
                .await?
            {
                Stage::Delivered
            } else {
                Stage::Queued
            };
            self.save(&saved)?;
        }
        if saved.stage != Stage::Delivered && saved.input.expires_at <= self.clock.now()? {
            self.acknowledgment
                .acknowledge(
                    &saved.input.message_id,
                    "skipped",
                    Some("Message expired before publication"),
                    stop,
                )
                .await?;
            self.artifacts.release(&[saved.input.message_id])?;
            return self.storage.remove(&self.file);
        }
        if saved.stage != Stage::Delivered {
            saved.text = self.artifacts.input(
                saved.input.text.clone(),
                &saved.input.message_id,
                maximum,
                &json!({"kind":"controller-input","expiresAt":saved.input.expires_at}),
            )?;
            saved.stage = Stage::Publishing;
            self.save(&saved)?;
            self.native
                .deliver(&saved.text, &saved.input.message_id, stop.clone(), None)
                .await?;
            saved.stage = Stage::Delivered;
            self.save(&saved)?;
        }
        self.acknowledgment
            .acknowledge(&saved.input.message_id, "delivered", None, stop)
            .await?;
        self.native
            .acknowledge(std::slice::from_ref(&saved.input.message_id))?;
        self.artifacts.release(&[saved.input.message_id])?;
        self.storage.remove(&self.file)
    }
}
