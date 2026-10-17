use crate::{
    protocol::Protocol,
    session::{self, Session, Status},
};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::{
    clock::NativeClock,
    delivery::{Delivery, Publication, Receipt},
    history::{self, Boundary},
    journal::{self, Journal, NativeMessage},
};
use crossfire_agent_core::runtime::Approval;
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub text: String,
    pub message_id: String,
    pub path: PathBuf,
    pub boundary: Option<Boundary>,
}

impl NativeMessage for Input {
    fn text(&self) -> &str {
        &self.text
    }
    fn message_id(&self) -> &str {
        &self.message_id
    }
    fn validate(&self) -> Result<()> {
        journal::validate_message(&self.text, &self.message_id)?;
        let id = self
            .message_id
            .strip_prefix("crossfire-instructions-")
            .ok_or_else(|| invalid("Invalid native instruction identity"))?;
        validation::identifier(&json!(id))?;
        if !self.path.is_absolute()
            || self.path.as_os_str().len() > 4096
            || self
                .path
                .components()
                .any(|value| !matches!(value, Component::RootDir | Component::Normal(_)))
        {
            return Err(invalid("Native instructions require an exact history path"));
        }
        if let Some(boundary) = &self.boundary
            && (boundary.key.is_empty()
                || boundary.key.len() > 100
                || boundary.prefix.len() != 64
                || !boundary
                    .prefix
                    .bytes()
                    .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value)))
        {
            return Err(invalid("Invalid native instruction history boundary"));
        }
        Ok(())
    }
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

struct Instructions<P> {
    session: Arc<Session<P>>,
    home: PathBuf,
}

impl<P: Protocol> Instructions<P> {
    async fn current(&self, cancellation: CancellationToken) -> Result<(PathBuf, bool)> {
        let current = self.session.current(cancellation).await?;
        let path = current
            .history
            .ok_or_else(|| invalid("Codex must expose its exact private native history path"))?;
        if current.status == Status::NotLoaded
            || !path.is_absolute()
            || path
                .components()
                .any(|value| !matches!(value, Component::RootDir | Component::Normal(_)))
            || path.as_os_str().len() > 4096
            || !path.starts_with(self.home.join("sessions"))
        {
            return Err(invalid(
                "Native instruction evidence must remain in this private managed history home",
            ));
        }
        Ok((path, current.status == Status::Idle))
    }

    fn header(&self, path: &Path) -> Result<bool> {
        let Some(value) = history::header(path)? else {
            return Ok(false);
        };
        let workspace = value
            .get("payload")
            .and_then(|value| value.get("cwd"))
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("Invalid native history workspace"))?;
        if value.get("type").and_then(Value::as_str) != Some("session_meta")
            || value
                .get("payload")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                != Some(self.session.id.as_str())
            || std::fs::canonicalize(workspace)
                .map_err(|_| invalid("Invalid native history workspace"))?
                != self.session.workspace
        {
            return Err(invalid(
                "Native history does not belong to the selected instruction session",
            ));
        }
        Ok(true)
    }
}

impl<P: Protocol> Publication<Input> for Instructions<P> {
    fn session_id(&self) -> &str {
        &self.session.id
    }
    fn approval(&self) -> Approval {
        self.session.approval
    }
    fn lifetime(&self) -> CancellationToken {
        self.session.protocol.lifetime()
    }
    async fn verify(&self, cancellation: CancellationToken) -> Result<()> {
        self.current(cancellation).await?;
        Ok(())
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(!self.current(self.lifetime()).await?.1)
    }
    async fn prepare(
        &self,
        text: &str,
        message_id: &str,
        cancellation: CancellationToken,
    ) -> Result<Input> {
        let (path, idle) = self.current(cancellation).await?;
        if !idle {
            return Err(invalid(
                "Native instructions require an idle owned session before publication",
            ));
        }
        let boundary = history::capture(&path)?;
        if boundary.is_some() && !self.header(&path)? {
            return Err(invalid(
                "Native history header is incomplete before instruction publication",
            ));
        }
        Ok(Input {
            text: text.to_owned(),
            message_id: message_id.to_owned(),
            path,
            boundary,
        })
    }
    async fn publish(&self, input: &Input, _journal: &mut Journal<Input>) -> Result<()> {
        let (path, idle) = self.current(self.lifetime()).await?;
        if !idle || path != input.path {
            return Err(invalid(
                "Native instruction publication lost its prepared history",
            ));
        }
        session::value(self.session.protocol.as_ref(), "thread/inject_items", &json!({"threadId":self.session.id,"items":[{"type":"message","id":input.message_id,"role":"developer","content":[{"type":"input_text","text":input.text}]}]}), self.lifetime()).await?;
        Ok(())
    }
    async fn received(
        &self,
        input: &Input,
        _journal: &mut Journal<Input>,
        cancellation: CancellationToken,
        _restored: bool,
    ) -> Result<Receipt> {
        if self.current(cancellation).await?.0 != input.path {
            return Err(invalid(
                "Native instruction recovery changed its retained history path",
            ));
        }
        if !self.header(&input.path)? {
            return Ok(Receipt::Absent);
        }
        let mut count = 0;
        history::since(&input.path, input.boundary.as_ref(), |value| {
            let value = value
                .as_object()
                .ok_or_else(|| invalid("Invalid native history record"))?;
            if value.get("type").and_then(Value::as_str) != Some("response_item") {
                return Ok(());
            }
            let item = value
                .get("payload")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("Invalid native response item"))?;
            if item.get("id").and_then(Value::as_str) != Some(input.message_id.as_str()) {
                return Ok(());
            }
            let content = item
                .get("content")
                .and_then(Value::as_array)
                .filter(|value| value.len() == 1)
                .and_then(|value| value[0].as_object())
                .ok_or_else(|| invalid("Invalid native developer instruction receipt"))?;
            if item.get("type").and_then(Value::as_str) != Some("message")
                || item.get("role").and_then(Value::as_str) != Some("developer")
                || content.get("type").and_then(Value::as_str) != Some("input_text")
                || content.get("text").and_then(Value::as_str) != Some(input.text.as_str())
            {
                return Err(invalid(
                    "Native developer instruction receipt differs from its submitted identity and content",
                ));
            }
            count += 1;
            if count > 1 {
                return Err(invalid(
                    "Native instruction identity was appended more than once",
                ));
            }
            Ok(())
        })?;
        Ok(if count == 1 {
            Receipt::Received
        } else {
            Receipt::Absent
        })
    }
    async fn cancel(&self, _input: &Input) -> Result<bool> {
        Ok(false)
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}

pub async fn ensure<P: Protocol>(
    session: Arc<Session<P>>,
    home: &Path,
    file: &Path,
    text: &str,
    cancellation: CancellationToken,
) -> Result<()> {
    PrivateDirectory::open(home, false)?;
    let native = Instructions {
        session: Arc::clone(&session),
        home: home.to_owned(),
    };
    let delivery = Delivery::open(native, NativeClock::default(), file, 100, 30_000)?;
    let operation = async {
        let state = journal::read::<Input>(file, &session.id)?;
        if state.confirmed.len() > 1 || state.pending.is_some() && !state.confirmed.is_empty() {
            return Err(invalid(
                "Native instructions have competing confirmed revisions",
            ));
        }
        if let Some(pending) = state.pending {
            delivery
                .recover(&pending.text, &pending.message_id, cancellation.clone())
                .await?;
        }
        let state = journal::read::<Input>(file, &session.id)?;
        let confirmed = state.confirmed.first();
        if let Some(confirmed) = confirmed
            && confirmed.digest == journal::digest(text)
        {
            if !delivery
                .recover(text, &confirmed.message_id, cancellation.clone())
                .await?
            {
                return Err(invalid("Native instructions lost their confirmed revision"));
            }
            return Ok(());
        }
        if let Some(confirmed) = confirmed {
            delivery.acknowledge(std::slice::from_ref(&confirmed.message_id))?;
        }
        delivery
            .deliver(
                text,
                &format!("crossfire-instructions-{}", identity::id()),
                cancellation,
            )
            .await
    };
    let result = operation.await;
    delivery.close().await?;
    result
}
