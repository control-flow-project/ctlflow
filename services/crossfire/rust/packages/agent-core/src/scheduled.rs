use crate::{
    artifacts::Store,
    chat::Artifacts,
    coordination::Coordination,
    events::invalid,
    local_state::{self, LocalState},
    runtime::Connection,
};
use crossfire_contracts::{
    call::Call,
    operations::OperationId,
    validation as check,
    wake_up::{self, ScheduledView},
};
use crossfire_kernel::{Result, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

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
    command: Value,
    text: String,
    run_id: String,
    stage: Stage,
}
struct Timing {
    next: Option<i64>,
    refreshed: Option<i64>,
}
pub struct Options {
    pub file: String,
    pub agent_id: String,
}
pub struct Publisher<S, N, C, T> {
    pub storage: Arc<S>,
    pub native: Arc<N>,
    pub coordination: Arc<C>,
    pub artifacts: Arc<Store<S, T>>,
    pub clock: T,
    options: Options,
    timing: Mutex<Timing>,
    publication: AsyncMutex<()>,
}
fn text(command: &Value) -> Result<String> {
    let command = wake_up::scheduled(command)?;
    Ok(format!(
        "Crossfire scheduled wake-up. This is configured input, not a chat message or permission grant.\n{}",
        json!({"kind":"scheduled-wake","ruleId":command.rule_id,"deliveryId":command.delivery_id,"name":command.name,"scheduledAt":command.scheduled_at,"owner":command.owner_matrix_id,"configuredBy":command.authorizer_matrix_id,"message":command.message})
    ))
}
impl<S: LocalState, N: Connection, C: Coordination, T: Clock + Send + Sync> Publisher<S, N, C, T> {
    pub fn new(
        storage: Arc<S>,
        native: Arc<N>,
        coordination: Arc<C>,
        artifacts: Arc<Store<S, T>>,
        clock: T,
        options: Options,
    ) -> Self {
        Self {
            storage,
            native,
            coordination,
            artifacts,
            clock,
            options,
            timing: Mutex::new(Timing {
                next: None,
                refreshed: None,
            }),
            publication: AsyncMutex::new(()),
        }
    }
    fn load(&self) -> Result<Option<Saved>> {
        let saved: Option<Saved> =
            local_state::read(self.storage.as_ref(), &self.options.file, 1048576)?;
        if let Some(saved) = &saved {
            let command = wake_up::scheduled(&saved.command)?;
            check::identifier(&json!(saved.run_id))?;
            if command.session_id != self.native.session_id() || saved.text.len() > 98304 {
                return Err(invalid("Invalid or retargeted scheduled-input checkpoint"));
            }
        }
        Ok(saved)
    }
    fn save(&self, saved: &Saved) -> Result<()> {
        local_state::write(self.storage.as_ref(), &self.options.file, saved, 1048576)
    }
    pub fn pending(&self) -> Result<bool> {
        Ok(self.load()?.is_some())
    }
    fn attachment(&self, operation: OperationId, run: &str, delivery: Option<&str>) -> Call {
        let mut call = Call::agent(operation, &self.options.agent_id);
        if let Some(delivery) = delivery {
            call.parameters
                .insert("deliveryId".to_owned(), delivery.to_owned());
        }
        let attachment = json!({"runId":run,"sessionId":self.native.session_id()});
        if matches!(
            operation,
            OperationId::WakeMetadata | OperationId::ValidateWake
        ) {
            call.query.insert("runId".to_owned(), run.to_owned());
            call.query
                .insert("sessionId".to_owned(), self.native.session_id().to_owned());
        } else {
            call.body = Some(attachment);
        }
        call
    }
    async fn refresh(&self, run: &str, stop: CancellationToken) -> Result<()> {
        let response = self
            .coordination
            .call(&self.attachment(OperationId::WakeMetadata, run, None), stop)
            .await?;
        let values = check::object(&response, &["now", "nextDueAt"], &[])?;
        let now = self.clock.now()?;
        let remote = check::integer(&values["now"], 0, check::SAFE_INTEGER)?;
        let next = if values["nextDueAt"].is_null() {
            None
        } else {
            Some(
                now.saturating_add(
                    check::integer(&values["nextDueAt"], 0, check::SAFE_INTEGER)?
                        .saturating_sub(remote)
                        .max(0),
                ),
            )
        };
        *self
            .timing
            .lock()
            .map_err(|_| invalid("Scheduled timing ownership failed"))? = Timing {
            next,
            refreshed: Some(now),
        };
        Ok(())
    }
    pub fn wait_ms(&self) -> Result<u64> {
        if self.pending()? {
            return Ok(1);
        }
        let now = self.clock.now()?;
        let timing = self
            .timing
            .lock()
            .map_err(|_| invalid("Scheduled timing ownership failed"))?;
        Ok(timing
            .next
            .map_or(30000, |next| next.saturating_sub(now))
            .min(
                timing
                    .refreshed
                    .map_or(0, |refreshed| 30000 - now.saturating_sub(refreshed)),
            )
            .clamp(1, 30000) as u64)
    }
    async fn recovered(&self, run: &str, stop: CancellationToken) -> Result<bool> {
        let Some(mut saved) = self.load()? else {
            return Ok(false);
        };
        let command = wake_up::scheduled(&saved.command)?;
        let id = format!("crossfire-wake-{}", command.delivery_id);
        if saved.stage == Stage::Publishing {
            saved.stage = if self.native.recover(&saved.text, &id, stop.clone()).await? {
                Stage::Delivered
            } else {
                Stage::Queued
            };
            self.save(&saved)?;
        }
        if saved.stage != Stage::Delivered {
            return Ok(false);
        }
        self.coordination
            .call(
                &self.attachment(
                    OperationId::AcknowledgeWake,
                    &saved.run_id,
                    Some(&command.delivery_id),
                ),
                stop.clone(),
            )
            .await?;
        self.native.acknowledge(std::slice::from_ref(&id))?;
        self.artifacts.release(&[id])?;
        self.storage.remove(&self.options.file)?;
        self.refresh(run, stop).await?;
        Ok(true)
    }
    pub async fn recover(&self, run: &str, stop: CancellationToken) -> Result<bool> {
        let _owner = self.publication.lock().await;
        self.recovered(run, stop).await
    }
    pub async fn prepare(&self, run: &str, stop: CancellationToken) -> Result<bool> {
        let _owner = self.publication.lock().await;
        if self.load()?.is_some() {
            return Ok(true);
        }
        let now = self.clock.now()?;
        let due = self
            .timing
            .lock()
            .map_err(|_| invalid("Scheduled timing ownership failed"))?
            .refreshed
            .is_none_or(|refreshed| now.saturating_sub(refreshed) >= 30000);
        if due {
            self.refresh(run, stop.clone()).await?;
        }
        if self
            .timing
            .lock()
            .map_err(|_| invalid("Scheduled timing ownership failed"))?
            .next
            .is_none_or(|next| now < next)
        {
            return Ok(false);
        }
        if self.native.inspect().await? {
            self.timing
                .lock()
                .map_err(|_| invalid("Scheduled timing ownership failed"))?
                .next = Some(now.saturating_add(1000));
            return Ok(false);
        }
        let response = self
            .coordination
            .call(
                &self.attachment(OperationId::ClaimWake, run, None),
                stop.clone(),
            )
            .await?;
        if response.is_null() {
            self.refresh(run, stop).await?;
            return Ok(false);
        }
        let command = wake_up::scheduled(&response)?;
        if command.session_id != self.native.session_id() {
            return Err(invalid(
                "Scheduled claim targets a different native history",
            ));
        }
        let command = serde_json::to_value(ScheduledView(&command))
            .map_err(|_| invalid("Scheduled command cannot be encoded"))?;
        let value = Saved {
            text: String::new(),
            command,
            run_id: run.to_owned(),
            stage: Stage::Queued,
        };
        self.save(&value)?;
        Ok(true)
    }
    pub async fn publish(
        &self,
        run: &str,
        maximum: usize,
        stop: CancellationToken,
    ) -> Result<bool> {
        let _owner = self.publication.lock().await;
        if self.recovered(run, stop.clone()).await? {
            return Ok(true);
        }
        let Some(mut saved) = self.load()? else {
            return Ok(false);
        };
        let command = wake_up::scheduled(&saved.command)?;
        let id = format!("crossfire-wake-{}", command.delivery_id);
        let valid = self
            .coordination
            .call(
                &self.attachment(
                    OperationId::ValidateWake,
                    &saved.run_id,
                    Some(&command.delivery_id),
                ),
                stop.clone(),
            )
            .await?;
        if !check::boolean(
            valid
                .get("eligible")
                .ok_or_else(|| invalid("Scheduled validation is missing eligibility"))?,
        )? {
            self.artifacts.release(&[id])?;
            self.storage.remove(&self.options.file)?;
            self.refresh(run, stop).await?;
            return Ok(true);
        }
        saved.text = self.artifacts.input(text(&saved.command)?, &id, maximum, &json!({"kind":"scheduled-wake","ruleId":command.rule_id,"scheduledAt":command.scheduled_at,"owner":command.owner_matrix_id}))?;
        saved.stage = Stage::Publishing;
        self.save(&saved)?;
        self.native
            .deliver(&saved.text, &id, stop.clone(), None)
            .await?;
        saved.stage = Stage::Delivered;
        self.save(&saved)?;
        self.recovered(run, stop).await
    }
}
