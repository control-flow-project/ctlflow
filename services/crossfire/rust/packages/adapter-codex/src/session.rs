use crate::{
    admission,
    options::{self, NativeOptions, Options},
    protocol::{Protocol, Reply},
};
use crossfire_agent_core::runtime::Approval;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

pub enum Selection<'a> {
    Create { name: &'a str },
    Resume { id: &'a str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Idle,
    Active,
    NotLoaded,
}

pub struct Thread {
    pub status: Status,
    pub history: Option<PathBuf>,
}

pub struct Session<P> {
    pub id: String,
    pub workspace: PathBuf,
    pub approval: Approval,
    pub model: String,
    pub effort: String,
    pub user_agent: Option<String>,
    pub protocol: Arc<P>,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

pub async fn value(
    protocol: &impl Protocol,
    method: &str,
    parameters: &Value,
    cancellation: CancellationToken,
) -> Result<Value> {
    match protocol.request(method, parameters, cancellation).await? {
        Reply::Value(value) => Ok(value),
        Reply::Error(_) => Err(invalid("Native Codex request was rejected")),
    }
}

pub async fn open<P: Protocol>(
    protocol: Arc<P>,
    workspace: &Path,
    selection: Selection<'_>,
    configured: &Options,
    cancellation: CancellationToken,
) -> Result<Session<P>> {
    let result = initialize(
        Arc::clone(&protocol),
        workspace,
        selection,
        configured,
        cancellation,
    )
    .await;
    if result.is_err() {
        protocol.close().await?;
    }
    result
}

async fn initialize<P: Protocol>(
    protocol: Arc<P>,
    workspace: &Path,
    selection: Selection<'_>,
    configured: &Options,
    cancellation: CancellationToken,
) -> Result<Session<P>> {
    let workspace = std::fs::canonicalize(workspace)
        .map_err(|_| invalid("The native workspace does not exist"))?;
    let original = match &selection {
        Selection::Resume { id } => {
            if id.len() != 36
                || !id.bytes().enumerate().all(|(offset, value)| {
                    if [8, 13, 18, 23].contains(&offset) {
                        value == b'-'
                    } else {
                        value.is_ascii_hexdigit()
                    }
                })
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Supply the exact Codex session UUID",
                ));
            }
            Some(*id)
        }
        Selection::Create { name } => {
            if name.is_empty() || name.chars().any(char::is_control) {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Use an exact native thread name",
                ));
            }
            None
        }
    };
    let initialized = value(protocol.as_ref(), "initialize", &json!({"clientInfo":{"name":"crossfire","title":"crossfire listener","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}), cancellation.clone()).await?;
    let user_agent = initialized
        .get("userAgent")
        .and_then(Value::as_str)
        .map(str::to_owned);
    protocol.notify("initialized", cancellation.clone()).await?;
    let admitted = admission::admit(protocol.as_ref(), configured, cancellation.clone()).await?;
    let mut native = serde_json::to_value(NativeOptions(configured))
        .map_err(|_| invalid("Invalid native configuration"))?;
    native["model"] = Value::String(admitted.model.clone());
    native["model_reasoning_effort"] = Value::String(admitted.effort.clone());
    let mut parameters = json!({"cwd":workspace,"config":native});
    let method = match &selection {
        Selection::Create { .. } => {
            parameters["historyMode"] = json!("paginated");
            parameters["ephemeral"] = json!(false);
            "thread/start"
        }
        Selection::Resume { id } => {
            parameters["threadId"] = json!(id);
            parameters["excludeTurns"] = json!(true);
            "thread/resume"
        }
    };
    let selected = value(protocol.as_ref(), method, &parameters, cancellation.clone()).await?;
    let id = selected
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("Codex did not select a native session"))?;
    if original.is_some_and(|original| original != id) {
        return Err(invalid("Codex did not resume the exact saved session"));
    }
    let approval_policy = selected
        .get("approvalPolicy")
        .ok_or_else(|| invalid("Native approval policy was not selected"))?;
    let approval = options::native_approval(approval_policy)?;
    if selected.get("model").and_then(Value::as_str) != Some(admitted.model.as_str())
        || selected.get("reasoningEffort").and_then(Value::as_str) != Some(admitted.effort.as_str())
        || selected
            .get("sandbox")
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            != Some(configured.sandbox.native_type())
        || approval_policy.as_str() != Some(configured.approval_policy.code())
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Codex did not apply the selected model, reasoning, sandbox and approval settings; no substitution is permitted",
        ));
    }
    if let Selection::Create { name } = selection {
        value(
            protocol.as_ref(),
            "thread/name/set",
            &json!({"threadId":id,"name":name}),
            cancellation.clone(),
        )
        .await?;
    }
    let session = Session {
        id: id.to_owned(),
        workspace,
        approval,
        model: admitted.model,
        effort: admitted.effort,
        user_agent,
        protocol,
    };
    let current = session.current(cancellation).await?;
    if current.status == Status::NotLoaded {
        return Err(invalid(
            "The selected native session must be loaded in this exact workspace",
        ));
    }
    Ok(session)
}

impl<P: Protocol> Session<P> {
    pub async fn current(&self, cancellation: CancellationToken) -> Result<Thread> {
        self.current_for(&self.id, cancellation).await
    }

    pub async fn current_for(&self, id: &str, cancellation: CancellationToken) -> Result<Thread> {
        let read = value(
            self.protocol.as_ref(),
            "thread/read",
            &json!({"threadId":id,"includeTurns":false}),
            cancellation,
        )
        .await?;
        let thread = read
            .get("thread")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("Invalid native thread state"))?;
        let status = match thread
            .get("status")
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
        {
            Some("idle") => Status::Idle,
            Some("active") => Status::Active,
            Some("notLoaded") => Status::NotLoaded,
            _ => {
                return Err(invalid(
                    "The selected native session is not loaded for direct input",
                ));
            }
        };
        let input = if status == Status::NotLoaded {
            Value::Null
        } else {
            Value::Bool(true)
        };
        let workspace = thread
            .get("cwd")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("The native thread did not expose its workspace"))?;
        if thread.get("id").and_then(Value::as_str) != Some(id)
            || thread.get("canAcceptDirectInput") != Some(&input)
            || std::fs::canonicalize(workspace)
                .map_err(|_| invalid("Native thread workspace does not exist"))?
                != self.workspace
        {
            return Err(invalid(
                "The Codex thread workspace or identity differs from this Crossfire identity; refusing delivery",
            ));
        }
        let history = thread
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from);
        Ok(Thread { status, history })
    }

    pub async fn close(&self) -> Result<()> {
        self.protocol.close().await
    }
}
