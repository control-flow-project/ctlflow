use crate::{protocol::Protocol, receipt, state};
use crossfire_adapter_runtime::{
    clock,
    delivery::{Delivery, Publication, Receipt},
    event_clock::EventClock,
    history::{self, Boundary},
    journal::{self, Journal, NativeMessage},
    resumption,
};
use crossfire_agent_core::runtime::{
    Admission, Approval, Hooks, InputPriority, InterruptResult, ObservationEvent, TurnControl,
};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Published {
    pub message_id: String,
    pub text: Arc<str>,
    pub boundary: Boundary,
    pub published: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[serde(flatten)]
    pub publication: Published,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resumption: Option<Published>,
}
impl NativeMessage for Input {
    fn text(&self) -> &str {
        &self.publication.text
    }
    fn message_id(&self) -> &str {
        &self.publication.message_id
    }
    fn validate(&self) -> Result<()> {
        for publication in std::iter::once(&self.publication).chain(self.resumption.iter()) {
            journal::validate_message(&publication.text, &publication.message_id)?;
            let boundary = &publication.boundary;
            validation::text(&json!(boundary.key), 1, 100)?;
            if boundary.position > validation::SAFE_INTEGER as u64
                || boundary.prefix.len() != 64
                || !boundary
                    .prefix
                    .bytes()
                    .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
            {
                return Err(invalid("Invalid native Pi publication boundary"));
            }
        }
        Ok(())
    }
}
pub struct Current {
    pub idle: bool,
    pub leaf: Option<String>,
    pub turn: Option<String>,
    pub pending: Option<String>,
}
pub async fn current(
    native: &impl Protocol,
    session: &str,
    cancellation: CancellationToken,
) -> Result<Current> {
    let value = native.control("state", &json!({}), cancellation).await?;
    if value.get("sessionId").and_then(Value::as_str) != Some(session) {
        return Err(invalid(
            "Pi control does not match the exact native history",
        ));
    }
    let string = |name| match value.get(name) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(invalid("Invalid native Pi control state")),
    };
    Ok(Current {
        idle: value
            .get("idle")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("Invalid native Pi idle state"))?,
        leaf: string("leafId")?,
        turn: string("turn")?,
        pending: string("pending")?,
    })
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

pub struct Configuration<H> {
    pub session: String,
    pub workspace: PathBuf,
    pub history: PathBuf,
    pub receipt: PathBuf,
    pub hooks: Arc<H>,
}
struct Signals {
    clock: EventClock,
    interrupted: AtomicBool,
    pending: AtomicBool,
    published: AtomicBool,
    replayed: AtomicBool,
}
struct PiPublication<P, H> {
    native: Arc<P>,
    options: Arc<Configuration<H>>,
    signals: Arc<Signals>,
}

impl<P: Protocol, H: Hooks> PiPublication<P, H> {
    async fn publish_input(&self, input: &Input, journal: &mut Journal<Input>) -> Result<()> {
        let selected = input.resumption.as_ref().unwrap_or(&input.publication);
        self.signals.pending.store(true, Ordering::Release);
        self.signals
            .published
            .store(selected.published, Ordering::Release);
        let response = self
            .native
            .control(
                "deliver",
                &json!({"text":selected.text,"messageId":selected.message_id}),
                self.native.lifetime(),
            )
            .await?;
        let armed = response
            .get("armed")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("Invalid native Pi publication result"))?;
        if armed {
            let mut retained = input.clone();
            retained
                .resumption
                .as_mut()
                .unwrap_or(&mut retained.publication)
                .published = true;
            journal.prepare(retained)?;
            self.signals.published.store(true, Ordering::Release);
        }
        Ok(())
    }
}
impl<P: Protocol, H: Hooks> Publication<Input> for PiPublication<P, H> {
    fn session_id(&self) -> &str {
        &self.options.session
    }
    fn approval(&self) -> Approval {
        Approval::None
    }
    fn lifetime(&self) -> CancellationToken {
        self.native.lifetime()
    }
    async fn verify(&self, cancellation: CancellationToken) -> Result<()> {
        clock::check(&cancellation)?;
        state::verify(
            &self.options.history,
            &self.options.workspace,
            &self.options.session,
        )?;
        current(self.native.as_ref(), &self.options.session, cancellation).await?;
        Ok(())
    }
    async fn inspect(&self) -> Result<bool> {
        let state = current(self.native.as_ref(), &self.options.session, self.lifetime()).await?;
        Ok(!state.idle || state.pending.is_some())
    }
    async fn prepare(
        &self,
        text: &str,
        id: &str,
        _cancellation: CancellationToken,
    ) -> Result<Input> {
        let boundary = history::capture(&self.options.history)?
            .ok_or_else(|| invalid("Pi history disappeared before native publication"))?;
        self.signals.interrupted.store(false, Ordering::Release);
        Ok(Input {
            publication: Published {
                text: Arc::from(text),
                message_id: id.to_owned(),
                boundary,
                published: false,
            },
            resumption: None,
        })
    }
    async fn publish(&self, input: &Input, journal: &mut Journal<Input>) -> Result<()> {
        self.publish_input(input, journal).await
    }
    async fn received(
        &self,
        input: &Input,
        journal: &mut Journal<Input>,
        cancellation: CancellationToken,
        restored: bool,
    ) -> Result<Receipt> {
        self.signals.clock.checked();
        let state = current(self.native.as_ref(), &self.options.session, cancellation).await?;
        let selected = input.resumption.as_ref().unwrap_or(&input.publication);
        if input.resumption.is_some() {
            resumption::retain(input, &self.options.receipt)?;
        }
        if receipt::received(
            &self.options.history,
            &selected.boundary,
            &selected.text,
            &selected.message_id,
            state.leaf.as_deref(),
        )? {
            self.signals.pending.store(false, Ordering::Release);
            if input.resumption.is_some() {
                self.options.hooks.observe(ObservationEvent::Output { session_id: self.options.session.clone(), id: selected.message_id.clone() + "-verified", stream_id: None,
                text: "Native execution resumed with the exact last message retained as context. Earlier receipt could not be established; completed actions must not be repeated.".to_owned() });
            }
            return Ok(Receipt::Received);
        }
        if restored
            && !self.signals.replayed.load(Ordering::Acquire)
            && state.idle
            && state.pending.is_none()
        {
            let boundary = history::capture(&self.options.history)?
                .ok_or_else(|| invalid("Pi history disappeared during restart recovery"))?;
            let text = resumption::text(input, &self.options.receipt, &self.options.workspace)?;
            let mut retained = input.clone();
            retained.resumption = Some(Published {
                text: Arc::from(text),
                message_id: identity::id(),
                boundary,
                published: false,
            });
            journal.prepare(retained.clone())?;
            self.signals.replayed.store(true, Ordering::Release);
            self.publish_input(&retained, journal).await?;
            return Ok(Receipt::Waiting);
        }
        if self.signals.interrupted.load(Ordering::Acquire) && !selected.published {
            self.signals.pending.store(false, Ordering::Release);
            return Ok(Receipt::Interrupted);
        }
        if !selected.published && !restored && state.idle && state.pending.is_none() {
            self.publish_input(input, journal).await?;
        }
        Ok(if state.idle {
            Receipt::Absent
        } else {
            Receipt::Waiting
        })
    }
    async fn cancel(&self, _input: &Input) -> Result<bool> {
        Ok(false)
    }
    async fn close(&self) -> Result<()> {
        self.native.close().await
    }
}

pub struct PiConnection<P, H> {
    native: Arc<P>,
    options: Arc<Configuration<H>>,
    signals: Arc<Signals>,
    delivery: Delivery<Input, PiPublication<P, H>, EventClock>,
}
impl<P: Protocol, H: Hooks> PiConnection<P, H> {
    pub fn open(native: Arc<P>, options: Configuration<H>) -> Result<Self> {
        let options = Arc::new(options);
        let signals = Arc::new(Signals {
            clock: EventClock::default(),
            interrupted: AtomicBool::new(false),
            pending: AtomicBool::new(false),
            published: AtomicBool::new(false),
            replayed: AtomicBool::new(false),
        });
        let publication = PiPublication {
            native: Arc::clone(&native),
            options: Arc::clone(&options),
            signals: Arc::clone(&signals),
        };
        let delivery = Delivery::open(
            publication,
            signals.clock.clone(),
            &options.receipt,
            1000,
            30_000,
        )?;
        Ok(Self {
            native,
            options,
            signals,
            delivery,
        })
    }
    pub fn session_id(&self) -> &str {
        &self.options.session
    }
    pub fn lifetime(&self) -> CancellationToken {
        self.native.lifetime()
    }
    pub fn changed(&self) {
        self.signals.clock.changed();
    }
    pub fn unsettled(&self) -> Result<bool> {
        self.delivery.unsettled()
    }
    pub fn acknowledge(&self, ids: &[String]) -> Result<()> {
        self.delivery.acknowledge(ids)
    }
    pub async fn inspect(&self) -> Result<bool> {
        self.delivery.inspect().await
    }
    pub async fn deliver(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
        _priority: Option<InputPriority>,
    ) -> Result<()> {
        self.delivery.deliver(text, id, cancellation).await
    }
    pub async fn recover(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
    ) -> Result<bool> {
        self.delivery.recover(text, id, cancellation).await
    }
    pub async fn settle(&self, cancellation: CancellationToken) -> Result<bool> {
        self.delivery.settle(cancellation).await
    }
    pub async fn close(&self) -> Result<()> {
        self.delivery.close().await
    }
}
impl<P: Protocol, H: Hooks> TurnControl for PiConnection<P, H> {
    async fn active_turn(
        &self,
        _room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        current(
            self.native.as_ref(),
            &self.options.session,
            admission
                .map(|value| value.cancellation.clone())
                .unwrap_or_else(|| self.lifetime()),
        )
        .await
        .map(|state| state.turn)
    }
    async fn interrupt(
        &self,
        turn: &str,
        _recovery: bool,
        admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        let cancellation = admission
            .map(|value| value.cancellation.clone())
            .unwrap_or_else(|| self.lifetime());
        let response = self
            .native
            .control("interrupt", &json!({"turn":turn}), cancellation)
            .await?;
        let interrupted = response
            .get("interrupted")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("Invalid native Pi captured interruption outcome"))?;
        if interrupted
            && self.signals.pending.load(Ordering::Acquire)
            && !self.signals.published.load(Ordering::Acquire)
        {
            self.signals.interrupted.store(true, Ordering::Release);
        }
        self.changed();
        Ok(if interrupted {
            InterruptResult::Interrupted
        } else {
            InterruptResult::Inactive
        })
    }
}
