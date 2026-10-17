use crate::{
    input::{Input, Published},
    protocol::Protocol,
    session::{self, Session, Status},
    timeline::{self, ReceiptStatus, Scan},
};
use crossfire_adapter_runtime::{
    clock,
    delivery::{Publication, Receipt},
    event_clock::EventClock,
    journal::Journal,
    resumption,
};
use crossfire_agent_core::runtime::{Approval, Hooks, ObservationEvent};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

pub struct CodexPublication<P, H> {
    pub session: Arc<Session<P>>,
    pub hooks: Arc<H>,
    pub clock: EventClock,
    pub receipt_file: PathBuf,
    unavailable: AtomicU8,
    resumed: AtomicBool,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

impl<P: Protocol, H: Hooks> CodexPublication<P, H> {
    pub fn new(
        session: Arc<Session<P>>,
        hooks: Arc<H>,
        clock: EventClock,
        receipt_file: PathBuf,
    ) -> Self {
        Self {
            session,
            hooks,
            clock,
            receipt_file,
            unavailable: AtomicU8::new(0),
            resumed: AtomicBool::new(false),
        }
    }

    async fn submit(&self, input: &Published, cancellation: CancellationToken) -> Result<String> {
        let response = session::value(self.session.protocol.as_ref(), "turn/start", &json!({"threadId":self.session.id,"clientUserMessageId":input.message_id,"input":[{"type":"text","text":input.text,"text_elements":[]}]}), cancellation).await?;
        response
            .get("turn")
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 200)
            .map(str::to_owned)
            .ok_or_else(|| invalid("Codex did not acknowledge a turn; delivery may be uncertain"))
    }

    async fn restart(
        &self,
        input: &Input,
        journal: &mut Journal<Input>,
        cancellation: CancellationToken,
    ) -> Result<Receipt> {
        let text = resumption::text(input, &self.receipt_file, &self.session.workspace)?;
        let id = format!("crossfire-resume-{}", identity::id());
        let notice = Published::new(
            &text,
            &id,
            timeline::capture(&self.session, cancellation.clone()).await?,
        );
        let mut retained = input.clone();
        retained.resumption = Some(notice.clone());
        journal.prepare(retained.clone())?;
        self.resumed.store(true, Ordering::Release);
        let turn = self.submit(&notice, cancellation).await?;
        retained
            .resumption
            .as_mut()
            .ok_or_else(|| invalid("Restart input lost its saved notice"))?
            .turn = Some(turn);
        journal.prepare(retained)?;
        Ok(Receipt::Waiting)
    }
}

impl<P: Protocol, H: Hooks> Publication<Input> for CodexPublication<P, H> {
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
        clock::check(&self.lifetime())?;
        if self.session.current(cancellation).await?.status == Status::NotLoaded {
            return Err(invalid(
                "The selected Codex session is not loaded for input",
            ));
        }
        Ok(())
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(self.session.current(self.lifetime()).await?.status == Status::Active)
    }
    async fn prepare(
        &self,
        text: &str,
        message_id: &str,
        cancellation: CancellationToken,
    ) -> Result<Input> {
        self.unavailable.store(0, Ordering::Release);
        Ok(Input {
            published: Published::new(
                text,
                message_id,
                timeline::capture(&self.session, cancellation).await?,
            ),
            resumption: None,
        })
    }
    async fn publish(&self, input: &Input, journal: &mut Journal<Input>) -> Result<()> {
        let turn = self.submit(&input.published, self.lifetime()).await?;
        let mut retained = input.clone();
        retained.published.turn = Some(turn);
        journal.prepare(retained)
    }
    async fn received(
        &self,
        input: &Input,
        journal: &mut Journal<Input>,
        cancellation: CancellationToken,
        restored: bool,
    ) -> Result<Receipt> {
        self.clock.checked();
        if input.resumption.is_some() {
            resumption::retain(input, &self.receipt_file)?;
        }
        let published = input.resumption.as_ref().unwrap_or(&input.published);
        let checked = match timeline::scan(
            &self.session,
            published.turn.as_deref(),
            &published.text,
            &published.message_id,
            published.boundary.as_ref(),
            cancellation.clone(),
        )
        .await?
        {
            Scan::Receipt(receipt) => receipt,
            Scan::TimelineUnavailable
                if published.initializing
                    && self.unavailable.fetch_add(1, Ordering::AcqRel) < 2 =>
            {
                return Ok(Receipt::Absent);
            }
            Scan::TimelineUnavailable => {
                return Err(invalid(
                    "Native input history is unavailable; read positions remain unchanged",
                ));
            }
        };
        if checked.status == ReceiptStatus::Received {
            if let Some(notice) = &input.resumption {
                self.hooks.observe(ObservationEvent::Output { session_id: self.session.id.clone(), id: notice.message_id.clone() + "-verified", stream_id: None,
                    text: "The previous message could not be verified after restart. Its exact source and text were supplied to a new Codex turn, with instructions to review history, avoid repeating completed actions and continue unfinished work.".to_owned() });
            }
            return Ok(Receipt::Received);
        }
        if ((restored && !self.resumed.load(Ordering::Acquire))
            || (input.resumption.is_some() && checked.status == ReceiptStatus::Interrupted))
            && self.session.current(cancellation.clone()).await?.status == Status::Idle
        {
            return self.restart(input, journal, cancellation).await;
        }
        if published.turn.is_none() {
            return Err(invalid(
                "Native input publication is uncertain; the saved journal prevents resubmission",
            ));
        }
        if published.initializing || checked.boundary != published.boundary {
            let mut retained = input.clone();
            let advanced = retained
                .resumption
                .as_mut()
                .unwrap_or(&mut retained.published);
            advanced.initializing = false;
            advanced.boundary = checked.boundary;
            journal.prepare(retained)?;
        }
        match checked.status {
            ReceiptStatus::Unavailable if self.unavailable.fetch_add(1, Ordering::AcqRel) < 2 => {
                Ok(Receipt::Absent)
            }
            ReceiptStatus::Unavailable => Err(invalid(
                "Codex did not retain the accepted turn; read positions remain unchanged",
            )),
            ReceiptStatus::Interrupted => {
                self.unavailable.store(0, Ordering::Release);
                Ok(Receipt::Interrupted)
            }
            ReceiptStatus::Missing => Err(invalid(
                "Codex finished without recording the input; read positions remain unchanged",
            )),
            ReceiptStatus::Pending => {
                self.unavailable.store(0, Ordering::Release);
                Ok(Receipt::Waiting)
            }
            ReceiptStatus::Received => Err(invalid(
                "Native receipt classification changed during inspection",
            )),
        }
    }
    async fn cancel(&self, _input: &Input) -> Result<bool> {
        Ok(false)
    }
    async fn close(&self) -> Result<()> {
        self.session.close().await
    }
}
