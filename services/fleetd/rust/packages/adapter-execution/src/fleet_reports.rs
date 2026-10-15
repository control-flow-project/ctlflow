use crossfire_agent_core::{
    coordination::Coordination,
    listener_control::Binding,
    listener_reporting::Activity,
    local_state::{self, LocalState},
};
use crossfire_contracts::{call::Call, operations::OperationId, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Mutex as AsyncMutex, Notify},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct Stop {
    activity: Activity,
    current: Arc<dyn Fn() -> Result<Binding> + Send + Sync>,
    receipt: Option<String>,
    confirmed: bool,
    error: Option<String>,
}
struct State {
    failures: Vec<Value>,
    episodes: BTreeSet<String>,
    stops: BTreeMap<String, Stop>,
    error: Option<String>,
}
pub struct Reports<S, C> {
    storage: Arc<S>,
    coordination: Arc<C>,
    fleet: String,
    file: String,
    state: Mutex<State>,
    flush: AsyncMutex<()>,
    changed: Notify,
    stop: CancellationToken,
    task: AsyncMutex<Option<JoinHandle<Result<()>>>>,
}
fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn same(left: &Binding, right: &Binding) -> bool {
    left.fleet_id == right.fleet_id
        && left.connection_id == right.connection_id
        && left.credential == right.credential
}
impl<S: LocalState + 'static, C: Coordination + 'static> Reports<S, C> {
    pub fn open(
        storage: Arc<S>,
        coordination: Arc<C>,
        fleet: &str,
        file: &str,
        stop: CancellationToken,
    ) -> Result<Arc<Self>> {
        check::identifier(&json!(fleet))?;
        let failures: Vec<Value> =
            local_state::read(storage.as_ref(), file, 33554432)?.unwrap_or_default();
        if failures.len() > 4096 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Controller failure journal exceeds its bounded queue",
            ));
        }
        let mut episodes = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for value in &failures {
            let source = check::object(
                value,
                &["episodeId", "agentId", "sessionId", "message"],
                &[],
            )?;
            if !ids.insert(check::identifier(&source["episodeId"])?.to_owned()) {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Duplicate controller failure episode",
                ));
            }
            episodes.insert(check::identifier(&source["agentId"])?.to_owned());
            if !source["sessionId"].is_null() {
                check::text(&source["sessionId"], 1, 255)?;
            }
            check::plain_text(&source["message"], 4000)?;
        }
        Ok(Arc::new(Self {
            storage,
            coordination,
            fleet: fleet.to_owned(),
            file: file.to_owned(),
            state: Mutex::new(State {
                failures,
                episodes,
                stops: BTreeMap::new(),
                error: None,
            }),
            flush: AsyncMutex::new(()),
            changed: Notify::new(),
            stop: stop.child_token(),
            task: AsyncMutex::new(None),
        }))
    }
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        let mut task = self.task.lock().await;
        if task.is_some() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Fleet reporting already owns its delivery task",
            ));
        }
        let reports = self.clone();
        *task = Some(tokio::spawn(async move { reports.run().await }));
        Ok(())
    }
    pub fn failure(&self, agent: &str, session: Option<&str>, error: &Failure) -> Result<()> {
        check::identifier(&json!(agent))?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?;
        if state.episodes.contains(agent) {
            return Ok(());
        }
        if state.failures.len() >= 4096 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Resolve queued failure reports before starting further native work",
            ));
        }
        let mut values = state.failures.clone();
        values.push(json!({"episodeId":identity::id(),"agentId":agent,"sessionId":session,"message":check::truncate_utf16(&error.message,4000)}));
        local_state::write(self.storage.as_ref(), &self.file, &values, 33554432)?;
        state.failures = values;
        state.episodes.insert(agent.to_owned());
        drop(state);
        self.changed.notify_one();
        Ok(())
    }
    pub fn recovered(&self, agent: &str) -> Result<()> {
        self.state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?
            .episodes
            .remove(agent);
        Ok(())
    }
    pub fn closed(
        &self,
        agent: &str,
        activity: Activity,
        current: Arc<dyn Fn() -> Result<Binding> + Send + Sync>,
    ) -> Result<()> {
        check::identifier(&json!(agent))?;
        check::identifier(&json!(activity.run_id))?;
        activity.binding.validate()?;
        if activity.binding.fleet_id != self.fleet {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native close proof belongs to another enrolled fleet",
            ));
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?;
        if state.stops.len() >= 100 && !state.stops.contains_key(agent) {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Native stop receipts exceed the fleet roster bound",
            ));
        }
        state.stops.insert(
            agent.to_owned(),
            Stop {
                activity,
                current,
                receipt: Some(identity::id()),
                confirmed: false,
                error: Some(
                    "Native process closed; its stop receipt is awaiting Crossfire acknowledgment"
                        .to_owned(),
                ),
            },
        );
        drop(state);
        self.changed.notify_one();
        Ok(())
    }
    pub fn forget(&self, agent: &str) -> Result<()> {
        self.state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?
            .stops
            .remove(agent);
        Ok(())
    }
    pub fn error(&self) -> Result<Option<String>> {
        let state = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?;
        Ok(state
            .error
            .clone()
            .or_else(|| state.stops.values().find_map(|entry| entry.error.clone())))
    }
    pub async fn confirm(&self, agent: &str, stop: CancellationToken) -> Result<()> {
        let _flush = self.flush.lock().await;
        let entry = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?
            .stops
            .get(agent)
            .cloned();
        let Some(entry) = entry else {
            return Ok(());
        };
        let receipt = entry.receipt.as_ref().ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                "Native close is not confirmed for this authenticated listener run",
            )
        })?;
        if !same(&entry.activity.binding, &(entry.current)()?) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native stop proof belongs to an expired controller generation; resume and stop the current binding before retirement",
            ));
        }
        if entry.confirmed {
            return Ok(());
        }
        let mut call = Call::new(OperationId::RecordFleetNativeStop);
        call.parameters.extend([
            ("fleetId".to_owned(), self.fleet.clone()),
            ("agentId".to_owned(), agent.to_owned()),
        ]);
        call.body = Some(
            json!({"connectionId":entry.activity.binding.connection_id,"runId":entry.activity.run_id,"receiptId":receipt}),
        );
        let result = self.coordination.call(&call, stop).await.and_then(|value| {
            if value["recorded"] == true {
                Ok(())
            } else {
                Err(Failure::new(
                    ErrorCode::Conflict,
                    "Crossfire did not accept the native stop receipt",
                ))
            }
        });
        let current = (entry.current)()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?;
        let actual = state
            .stops
            .get_mut(agent)
            .filter(|actual| actual.receipt == entry.receipt)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "New authenticated activity invalidated this native stop receipt",
                )
            })?;
        if let Err(error) = result {
            actual.error = Some(error.message.clone());
            return Err(error);
        }
        if !same(&entry.activity.binding, &current) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native stop receipt authority changed during confirmation",
            ));
        }
        actual.confirmed = true;
        actual.error = None;
        Ok(())
    }
    async fn flush_failures(&self) -> Result<()> {
        let selected = self
            .state
            .lock()
            .map_err(|_| failed("Controller reporting ownership failed"))?
            .failures
            .iter()
            .take(4)
            .cloned()
            .collect::<Vec<_>>();
        for value in selected {
            let mut call = Call::new(OperationId::ReportFleetFailure);
            call.parameters
                .insert("fleetId".to_owned(), self.fleet.clone());
            call.body = Some(value.clone());
            self.coordination.call(&call, self.stop.clone()).await?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| failed("Controller reporting ownership failed"))?;
            let mut next = state.failures.clone();
            next.retain(|pending| pending["episodeId"] != value["episodeId"]);
            local_state::write(self.storage.as_ref(), &self.file, &next, 33554432)?;
            state.failures = next;
        }
        Ok(())
    }
    async fn run(&self) -> Result<()> {
        loop {
            if self.stop.is_cancelled() {
                return Ok(());
            }
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let result = self.flush_failures().await;
            let agents = self
                .state
                .lock()
                .map_err(|_| failed("Controller reporting ownership failed"))?
                .stops
                .iter()
                .filter(|(_, entry)| !entry.confirmed)
                .take(4)
                .map(|(agent, _)| agent.clone())
                .collect::<Vec<_>>();
            let mut error = result.err();
            for agent in agents {
                if let Err(failure) = self.confirm(&agent, self.stop.clone()).await {
                    error.get_or_insert(failure);
                }
            }
            let pending = {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| failed("Controller reporting ownership failed"))?;
                state.error = error.map(|error| error.message);
                !state.failures.is_empty() || state.stops.values().any(|entry| !entry.confirmed)
            };
            tokio::select! { biased; _=self.stop.cancelled()=>return Ok(()),_=notified=>{},_=async { if pending { tokio::time::sleep(Duration::from_secs(1)).await; } else { std::future::pending::<()>().await; } }=>{} }
        }
    }
    pub async fn close(&self) -> Result<()> {
        self.stop.cancel();
        self.changed.notify_waiters();
        if let Some(task) = self.task.lock().await.take() {
            task.await
                .map_err(|_| failed("Controller reporting task failed during shutdown"))??;
        }
        Ok(())
    }
}
