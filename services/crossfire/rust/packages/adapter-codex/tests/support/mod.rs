use crossfire_adapter_codex::{
    protocol::{NativeError, Protocol, Reply},
    session::Session,
};
use crossfire_agent_core::runtime::{Approval, Decision, Hooks, ObservationEvent};
use crossfire_domain::statistics::Usage;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

pub enum Answer {
    Value(Value),
    Error(i64, &'static str),
    LostResponse,
    Start,
    Receipt,
}

pub type Calls = Arc<Mutex<Vec<(String, Value)>>>;

pub struct Native {
    pub steps: Mutex<VecDeque<(&'static str, Answer)>>,
    pub calls: Calls,
    pub journal: Option<PathBuf>,
    pub cancellation: CancellationToken,
}

impl Native {
    pub fn session(
        workspace: &Path,
        steps: Vec<(&'static str, Answer)>,
        journal: Option<PathBuf>,
        previous: Option<Calls>,
    ) -> Arc<Session<Self>> {
        Arc::new(Session {
            id: "session".to_owned(),
            workspace: workspace.to_owned(),
            approval: Approval::None,
            model: "fixture".to_owned(),
            effort: "high".to_owned(),
            user_agent: None,
            protocol: Arc::new(Self {
                steps: Mutex::new(steps.into()),
                calls: previous.unwrap_or_default(),
                journal,
                cancellation: CancellationToken::new(),
            }),
        })
    }
}

impl Protocol for Native {
    fn lifetime(&self) -> CancellationToken {
        self.cancellation.clone()
    }
    async fn request(
        &self,
        method: &str,
        parameters: &Value,
        cancellation: CancellationToken,
    ) -> Result<Reply> {
        crossfire_adapter_runtime::clock::check(&cancellation)?;
        let invalid = || Failure::new(ErrorCode::Native, "Unexpected fixture request");
        self.calls
            .lock()
            .map_err(|_| invalid())?
            .push((method.to_owned(), parameters.clone()));
        let (expected, answer) = self
            .steps
            .lock()
            .map_err(|_| invalid())?
            .pop_front()
            .ok_or_else(invalid)?;
        assert_eq!(method, expected);
        if method == "turn/start"
            && let Some(journal) = &self.journal
        {
            let value: Value =
                serde_json::from_slice(&std::fs::read(journal).map_err(|_| invalid())?)
                    .map_err(|_| invalid())?;
            let publication = if value["pending"].get("resumption").is_some() {
                &value["pending"]["resumption"]
            } else {
                &value["pending"]
            };
            assert_eq!(
                publication["messageId"], parameters["clientUserMessageId"],
                "Journal exists before native publication"
            );
            assert_eq!(publication["text"], parameters["input"][0]["text"]);
        }
        match answer {
            Answer::Value(value) => Ok(Reply::Value(value)),
            Answer::Error(code, message) => Ok(Reply::Error(NativeError {
                code,
                message: message.to_owned(),
            })),
            Answer::LostResponse => Err(Failure::new(
                ErrorCode::Native,
                "Native reply lost after transmission",
            )),
            Answer::Start => Ok(Reply::Value(json!({"turn":{"id":"turn"}}))),
            Answer::Receipt => {
                let calls = self.calls.lock().map_err(|_| invalid())?;
                let input = calls
                    .iter()
                    .rev()
                    .find(|(method, _)| method == "turn/start")
                    .ok_or_else(invalid)?;
                Ok(Reply::Value(
                    json!({"data":[{"position":1,"type":"item","turnId":"turn","item":{"type":"userMessage","id":"item","clientId":input.1["clientUserMessageId"],"content":[{"type":"text","text":input.1["input"][0]["text"]}]}}],"nextCursor":null}),
                ))
            }
        }
    }
    async fn notify(&self, _method: &str, _cancellation: CancellationToken) -> Result<()> {
        Ok(())
    }
    async fn close(&self) -> Result<()> {
        self.cancellation.cancel();
        Ok(())
    }
}

#[derive(Default)]
pub struct Observations(pub Mutex<Vec<ObservationEvent>>);
impl Hooks for Observations {
    async fn request_decision(
        &self,
        _decision: &Decision,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "This fixture cannot approve decisions",
        ))
    }
    fn decision_responded(&self, _decision: &Decision) {}
    fn usage(&self, _sample: &Usage) {}
    fn pending_decisions(&self) -> bool {
        false
    }
    fn pending_input(&self) -> bool {
        false
    }
    fn observe(&self, event: ObservationEvent) {
        if let Ok(mut events) = self.0.lock() {
            events.push(event);
        }
    }
}

pub fn idle(workspace: &Path) -> Answer {
    state(workspace, "idle")
}
pub fn state(workspace: &Path, status: &str) -> Answer {
    Answer::Value(
        json!({"thread":{"id":"session","cwd":workspace,"status":{"type":status},"canAcceptDirectInput":true}}),
    )
}
pub fn empty() -> Answer {
    Answer::Value(json!({"data":[],"nextCursor":null}))
}
