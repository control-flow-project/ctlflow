use crate::{
    connection::{self, PiConnection},
    observation::Observer,
    options,
    protocol::{Events, Protocol, Rpc},
    questions,
};
use crossfire_agent_core::runtime::Hooks;
use crossfire_domain::runtime::values::State;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

struct Activity {
    run: CancellationToken,
    fault: Option<String>,
    interrupted: bool,
}
pub struct NativeEvents<H> {
    pub observer: Arc<Observer<H>>,
    hooks: Arc<H>,
    native: OnceLock<Weak<Rpc>>,
    connection: OnceLock<Weak<PiConnection<Rpc, H>>>,
    session: Mutex<String>,
    activity: Mutex<Activity>,
    questions: Mutex<JoinSet<()>>,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}
impl<H: Hooks + 'static> NativeEvents<H> {
    pub fn new(hooks: Arc<H>, expected: Option<&str>) -> Self {
        Self {
            observer: Arc::new(Observer::new(Arc::clone(&hooks))),
            hooks,
            native: OnceLock::new(),
            connection: OnceLock::new(),
            session: Mutex::new(expected.unwrap_or("").to_owned()),
            activity: Mutex::new(Activity {
                run: CancellationToken::new(),
                fault: None,
                interrupted: false,
            }),
            questions: Mutex::new(JoinSet::new()),
        }
    }
    pub fn bind_native(&self, native: &Arc<Rpc>) -> Result<()> {
        self.native
            .set(Arc::downgrade(native))
            .map_err(|_| invalid("Pi native callbacks acquired multiple owners"))
    }
    pub fn selected(
        &self,
        session: &str,
        settings: Vec<crossfire_domain::runtime::values::Setting>,
    ) -> Result<()> {
        let mut identity = self
            .session
            .lock()
            .map_err(|_| invalid("Pi session ownership failed"))?;
        if !identity.is_empty() && *identity != session {
            return Err(invalid("Pi substituted the native context identity"));
        }
        *identity = session.to_owned();
        drop(identity);
        self.observer.configure(session, settings)
    }
    pub fn bind_connection(&self, connection: &Arc<PiConnection<Rpc, H>>) -> Result<()> {
        self.connection
            .set(Arc::downgrade(connection))
            .map_err(|_| invalid("Pi callbacks acquired multiple native connections"))
    }
    pub async fn close(&self) -> Result<()> {
        self.activity
            .lock()
            .map_err(|_| invalid("Pi activity ownership failed"))?
            .run
            .cancel();
        let mut jobs = std::mem::take(
            &mut *self
                .questions
                .lock()
                .map_err(|_| invalid("Pi decision ownership failed"))?,
        );
        while let Some(job) = jobs.join_next().await {
            job.map_err(|_| invalid("Pi owner-decision task failed during cleanup"))?;
        }
        Ok(())
    }
    fn ask(&self, event: Value, session: String) -> Result<()> {
        let native = self
            .native
            .get()
            .and_then(Weak::upgrade)
            .ok_or_else(|| invalid("Pi requested human input before native readiness"))?;
        let connection = self
            .connection
            .get()
            .and_then(Weak::upgrade)
            .ok_or_else(|| invalid("Pi requested human input before its history was ready"))?;
        let run = self
            .activity
            .lock()
            .map_err(|_| invalid("Pi activity ownership failed"))?
            .run
            .clone();
        if connection.session_id() != session {
            return Err(invalid("Pi question belongs to a different native context"));
        }
        let hooks = Arc::clone(&self.hooks);
        let observer = Arc::clone(&self.observer);
        observer.state(State::WaitingAnswer, None)?;
        self.questions.lock().map_err(|_| invalid("Pi decision ownership failed"))?.spawn(async move {
            let scope = crossfire_adapter_runtime::clock::Scope::new(&native.lifetime(), run.clone());
            let operation = async {
                let current = connection::current(native.as_ref(), &session, scope.cancellation.clone()).await?;
                let turn = current.turn.ok_or_else(|| invalid("Pi question has no original active execution"))?;
                let decision = questions::question(&event, &session, &turn)?;
                let response = questions::answer(native.as_ref(), hooks.as_ref(), &decision, scope.cancellation.clone());
                match decision.expires_ms {
                    Some(milliseconds) => {
                        tokio::pin!(response);
                        tokio::select! { biased;
                            result = &mut response => result?,
                            _ = tokio::time::sleep(Duration::from_millis(milliseconds as u64)) => {
                                scope.cancellation.cancel();
                                let _cancelled = response.await;
                                if !run.is_cancelled() && !native.lifetime().is_cancelled() { native.notify(&json!({"type":"extension_ui_response","id":decision.request_id,"cancelled":true}), native.lifetime()).await?; }
                            }
                        }
                    },
                    None => response.await?,
                }
                if !run.is_cancelled() && !native.lifetime().is_cancelled() { observer.state(State::Working, None)?; }
                Ok(())
            }.await;
            if let Err(failure) = operation && !run.is_cancelled() && !native.lifetime().is_cancelled() { native.fail(failure); }
        });
        Ok(())
    }
}
impl<H: Hooks + 'static> Events for NativeEvents<H> {
    fn event(&self, event: Value) -> Result<()> {
        {
            let mut questions = self
                .questions
                .lock()
                .map_err(|_| invalid("Pi decision ownership failed"))?;
            while let Some(completed) = questions.try_join_next() {
                completed.map_err(|_| invalid("Pi owner-decision task failed"))?;
            }
        }
        if let Some(connection) = self.connection.get().and_then(Weak::upgrade) {
            connection.changed();
        }
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("Invalid native Pi event"))?;
        if kind == "extension_error" {
            return Err(invalid(&options::error_text(
                event
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Native Pi extension failed"),
            )));
        }
        {
            let mut activity = self
                .activity
                .lock()
                .map_err(|_| invalid("Pi activity ownership failed"))?;
            if kind == "agent_start" {
                activity.run.cancel();
                activity.run = CancellationToken::new();
                activity.fault = None;
                activity.interrupted = false;
            }
            if kind == "interruption_started" {
                activity.interrupted = true;
                activity.run.cancel();
            }
            if kind == "message_end"
                && let Some(message) = event.get("message").filter(|message| {
                    message.get("role").and_then(Value::as_str) == Some("assistant")
                })
            {
                activity.fault = (message.get("stopReason").and_then(Value::as_str)
                    == Some("error"))
                .then(|| {
                    options::error_text(
                        message
                            .get("errorMessage")
                            .and_then(Value::as_str)
                            .unwrap_or("Pi execution failed"),
                    )
                });
            }
            if kind == "agent_settled" {
                activity.run.cancel();
                if let Some(fault) = &activity.fault
                    && !activity.interrupted
                {
                    let fault = fault.clone();
                    drop(activity);
                    self.observer.state(State::Failed, Some(&fault))?;
                    return Err(invalid(&fault));
                }
            }
        }
        let session = self
            .session
            .lock()
            .map_err(|_| invalid("Pi session ownership failed"))?
            .clone();
        if kind == "extension_ui_request"
            && event
                .get("method")
                .and_then(Value::as_str)
                .is_some_and(|method| ["confirm", "select", "input", "editor"].contains(&method))
        {
            return self.ask(event, session);
        }
        self.observer.event(&event)
    }
}
