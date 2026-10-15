use crate::{
    coordination::Coordination,
    events::{self, Event, invalid},
    listener_control::{Binding, Control},
    local_state,
    statistics::{self, Collector},
};
use crossfire_contracts::{
    call::Call, operations::OperationId, statistics::BatchWire, validation as check,
};
use crossfire_domain::statistics::Usage;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::sync::{Mutex as AsyncMutex, watch};
use tokio_util::sync::CancellationToken;

struct Run {
    id: String,
    generation: CancellationToken,
    binding: Binding,
    messages: i64,
    reported_at: i64,
    stopped: bool,
}
#[derive(Clone)]
pub struct Activity {
    pub run_id: String,
    pub binding: Binding,
}
pub struct Reporter<C, T> {
    pub coordination: Arc<C>,
    pub control: Arc<Control>,
    pub clock: T,
    pub agent_id: String,
    pub release: String,
    statistics: Mutex<Collector>,
    run: Mutex<Option<Run>>,
    owner: AsyncMutex<()>,
    ready: watch::Sender<Option<String>>,
}
impl<C: Coordination, T: Clock + Send + Sync> Reporter<C, T> {
    pub fn new(
        coordination: Arc<C>,
        control: Arc<Control>,
        clock: T,
        agent_id: String,
        principal: &str,
        release: String,
    ) -> Result<Self> {
        check::identifier(&json!(agent_id))?;
        crossfire_contracts::release::identity(&release)?;
        let statistics = Mutex::new(Collector::new(principal, clock.now()?));
        let (ready, _) = watch::channel(None);
        Ok(Self {
            coordination,
            control,
            clock,
            agent_id,
            release,
            statistics,
            run: Mutex::new(None),
            owner: AsyncMutex::new(()),
            ready,
        })
    }
    pub fn ready(&self) -> watch::Receiver<Option<String>> {
        self.ready.subscribe()
    }
    pub fn run(&self) -> Result<Option<String>> {
        Ok(self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_ref()
            .filter(|run| !run.stopped)
            .map(|run| run.id.clone()))
    }
    pub fn last_reported_activity(&self) -> Result<Option<Activity>> {
        Ok(self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_ref()
            .map(|run| Activity {
                run_id: run.id.clone(),
                binding: run.binding.clone(),
            }))
    }
    pub fn usage(&self, sample: &Usage) -> Result<()> {
        self.statistics
            .lock()
            .map_err(|_| invalid("Listener statistics ownership failed"))?
            .usage(sample);
        Ok(())
    }
    pub fn record(&self, values: &[Event], delivered: bool) -> Result<()> {
        let mut statistics = self
            .statistics
            .lock()
            .map_err(|_| invalid("Listener statistics ownership failed"))?;
        let mut count = 0_i64;
        for event in values {
            let bytes = event.content_file.as_ref().map_or_else(
                || local_state::encoded_bytes(&event.content),
                |file| Ok(file.source_bytes),
            )?;
            let attachments = event.content_file.as_ref().map_or_else(
                || {
                    event
                        .content
                        .get("info")
                        .and_then(|info| info.get("size"))
                        .and_then(Value::as_i64)
                        .unwrap_or(0)
                        .max(0)
                },
                |file| file.attachment_bytes,
            );
            statistics.record(
                &statistics::Event {
                    room_id: &event.room_id,
                    sender: &event.sender,
                    event_id: &event.event_id,
                    message_type: event
                        .content
                        .get("msgtype")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    content_bytes: i64::try_from(bytes)
                        .map_err(|_| invalid("Message byte accounting overflow"))?,
                    attachment_bytes: attachments,
                    room_message: event.kind == "m.room.message",
                    listener_notice: events::notice_content(&event.content),
                },
                delivered,
            );
            if event.kind == "m.room.message" {
                count += 1;
            }
        }
        if delivered
            && let Some(run) = self
                .run
                .lock()
                .map_err(|_| invalid("Listener reporting ownership failed"))?
                .as_mut()
        {
            run.messages = run
                .messages
                .checked_add(count)
                .filter(|count| *count <= check::SAFE_INTEGER)
                .ok_or_else(|| invalid("Delivered message accounting overflow"))?;
        }
        Ok(())
    }
    async fn report(&self, stopped: bool, stop: CancellationToken) -> Result<String> {
        let now = self.clock.now()?;
        let batch = self
            .statistics
            .lock()
            .map_err(|_| invalid("Listener statistics ownership failed"))?
            .batch(now, stopped);
        let (id, body) = {
            let state = self
                .run
                .lock()
                .map_err(|_| invalid("Listener reporting ownership failed"))?;
            let run = state
                .as_ref()
                .ok_or_else(|| invalid("Listener reporting has no active run"))?;
            (
                run.id.clone(),
                json!({"release":self.release,"messagesDelivered":run.messages,"stopped":stopped,"controller":run.binding.value(),"statistics":batch.as_ref().map(|batch| BatchWire(batch.as_ref()))}),
            )
        };
        let mut request = Call::agent(OperationId::ReportListener, &self.agent_id);
        request.parameters.insert("runId".to_owned(), id.clone());
        request.body = Some(body);
        let response = self.coordination.call(&request, stop).await?;
        let value = check::object(
            &response,
            &["disconnect", "currentRelease", "statisticsAccepted"],
            &[],
        )?;
        if check::boolean(&value["statisticsAccepted"])?
            && let Some(batch) = batch
        {
            self.statistics
                .lock()
                .map_err(|_| invalid("Listener statistics ownership failed"))?
                .acknowledge(&batch);
        }
        let release = check::text(&value["currentRelease"], 1, 1000)?.to_owned();
        crossfire_contracts::release::identity(&release)?;
        if let Some(run) = self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_mut()
            && run.id == id
        {
            run.reported_at = now;
        }
        if !stopped && check::boolean(&value["disconnect"])? {
            self.control.unavailable()?;
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Listener admission expired; reconnect the authenticated controller lease",
            ));
        }
        Ok(release)
    }
    pub async fn activate(&self, stop: CancellationToken) -> Result<Option<String>> {
        let _owner = self.owner.lock().await;
        let snapshot = self.control.current()?;
        let previous = self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_ref()
            .map(|run| run.stopped || run.generation.is_cancelled());
        if previous == Some(false) && snapshot.active {
            return self.run();
        }
        if previous.is_some() {
            self.pause_owned(stop.clone()).await?;
        }
        if !snapshot.active || snapshot.generation.is_cancelled() {
            return Ok(None);
        }
        let id = identity::id();
        *self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))? = Some(Run {
            id: id.clone(),
            generation: snapshot.generation,
            binding: snapshot.binding,
            messages: 0,
            reported_at: 0,
            stopped: false,
        });
        if let Err(error) = self.report(false, stop).await {
            self.control.unavailable()?;
            self.ready.send_replace(None);
            return Err(error);
        }
        self.ready.send_replace(Some(id.clone()));
        Ok(Some(id))
    }
    pub async fn heartbeat(&self, stop: CancellationToken) -> Result<Option<String>> {
        let _owner = self.owner.lock().await;
        let now = self.clock.now()?;
        let due = self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_ref()
            .is_some_and(|run| !run.stopped && now.saturating_sub(run.reported_at) >= 30000);
        if due {
            self.report(false, stop).await.map(Some)
        } else {
            Ok(None)
        }
    }
    async fn pause_owned(&self, stop: CancellationToken) -> Result<()> {
        self.ready.send_replace(None);
        if self.run()?.is_none() {
            return Ok(());
        }
        self.report(true, stop).await?;
        if let Some(run) = self
            .run
            .lock()
            .map_err(|_| invalid("Listener reporting ownership failed"))?
            .as_mut()
        {
            run.stopped = true;
        }
        Ok(())
    }
    pub async fn pause(&self, stop: CancellationToken) -> Result<()> {
        let _owner = self.owner.lock().await;
        self.pause_owned(stop).await
    }
}
