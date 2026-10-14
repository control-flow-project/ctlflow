use crate::{
    decisions,
    observation::Observer,
    protocol::{Callbacks, Event, Request, RequestId},
};
use crossfire_adapter_runtime::clock;
use crossfire_agent_core::runtime::{Decision, Hooks};
use crossfire_domain::runtime::values::State;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
};
use tokio_util::sync::CancellationToken;

type Forward = Box<dyn Fn(&Event) -> Result<()> + Send + Sync>;
#[derive(Default)]
struct Binding {
    session: String,
    failure: Option<Failure>,
    changes: BTreeMap<String, Arc<Value>>,
    decisions: BTreeMap<RequestId, Decision>,
}

pub struct SessionCallbacks<H> {
    hooks: Arc<H>,
    observer: Observer<H>,
    binding: Mutex<Binding>,
    forward: OnceLock<Forward>,
    cancellation: CancellationToken,
}

fn invalid() -> Failure {
    Failure::new(ErrorCode::Native, "Native Codex callback ownership failed")
}

impl<H: Hooks> SessionCallbacks<H> {
    pub fn new(hooks: Arc<H>, session: Option<&str>, cancellation: CancellationToken) -> Self {
        Self {
            observer: Observer::new(Arc::clone(&hooks)),
            hooks,
            binding: Mutex::new(Binding {
                session: session.unwrap_or("").to_owned(),
                ..Binding::default()
            }),
            forward: OnceLock::new(),
            cancellation: cancellation.child_token(),
        }
    }
    pub fn lifetime(&self) -> CancellationToken {
        self.cancellation.clone()
    }
    pub fn selected(
        &self,
        session: &str,
        configured: &Value,
        selected: &Value,
        version: Option<&str>,
        state: State,
    ) -> Result<()> {
        let mut binding = self.binding.lock().map_err(|_| invalid())?;
        if !binding.session.is_empty() && binding.session != session {
            return Err(invalid());
        }
        binding.session = session.to_owned();
        drop(binding);
        self.observer.configure(configured, selected, version)?;
        self.observer.state(session, state, None)
    }
    pub fn forward(
        &self,
        callback: impl Fn(&Event) -> Result<()> + Send + Sync + 'static,
    ) -> Result<()> {
        self.forward.set(Box::new(callback)).map_err(|_| invalid())
    }
    pub fn failure(&self) -> Result<Option<Failure>> {
        Ok(self.binding.lock().map_err(|_| invalid())?.failure.clone())
    }
    fn event_checked(&self, event: &Event) -> Result<()> {
        let mut binding = self.binding.lock().map_err(|_| invalid())?;
        let session = binding.session.clone();
        if event.params.get("threadId").and_then(Value::as_str) == Some(session.as_str())
            && ["item/started", "item/completed"].contains(&event.method.as_str())
            && let Some(item) = event.params.get("item").and_then(Value::as_object)
            && item.get("type").and_then(Value::as_str) == Some("fileChange")
        {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(invalid)?;
            if event.method == "item/completed" {
                binding.changes.remove(id);
            } else {
                binding.changes.insert(
                    id.to_owned(),
                    Arc::new(item.get("changes").ok_or_else(invalid)?.clone()),
                );
            }
        }
        drop(binding);
        self.observer.event(event, &session)?;
        if let Some(forward) = self.forward.get() {
            forward(event)?;
        }
        Ok(())
    }
    fn fail(&self, failure: Failure) {
        if let Ok(mut binding) = self.binding.lock() {
            if binding.failure.is_none() {
                binding.failure = Some(failure);
            }
            binding.changes.clear();
            binding.decisions.clear();
        }
        self.cancellation.cancel();
    }
}

impl<H: Hooks> Callbacks for SessionCallbacks<H> {
    fn event(&self, event: Event) {
        if let Err(failure) = self.event_checked(&event) {
            self.fail(failure);
        }
    }
    async fn decision(&self, request: &Request, cancellation: CancellationToken) -> Result<Value> {
        clock::check(&cancellation)?;
        let (session, changes) = {
            let binding = self.binding.lock().map_err(|_| invalid())?;
            (
                binding.session.clone(),
                request
                    .params
                    .get("itemId")
                    .and_then(Value::as_str)
                    .and_then(|id| binding.changes.get(id))
                    .cloned(),
            )
        };
        let decision = if request.method == "item/tool/requestUserInput" {
            decisions::question(request, &session)?
        } else {
            decisions::permission(request, &session, changes.as_deref())?
        };
        let response = self
            .hooks
            .request_decision(&decision, cancellation.clone())
            .await;
        clock::check(&cancellation)?;
        let response = match response {
            Ok(response) => response,
            Err(failure) => return decisions::denial(&decision).cloned().ok_or(failure),
        };
        if !decisions::available_answer(&decision, &response) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Response is not a native available decision",
            ));
        }
        let mut binding = self.binding.lock().map_err(|_| invalid())?;
        if binding.decisions.contains_key(&request.id) {
            return Err(invalid());
        }
        binding.decisions.insert(request.id.clone(), decision);
        Ok(response)
    }
    fn responded(&self, request: &Request) {
        let decision = self
            .binding
            .lock()
            .ok()
            .and_then(|mut binding| binding.decisions.remove(&request.id));
        if let Some(decision) = decision {
            self.hooks.decision_responded(&decision);
        }
    }
}
