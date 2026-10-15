use crate::{
    coordination::Coordination,
    events::invalid,
    local_state::{self, LocalState},
    matrix::{self, API, Matrix, Request},
    owner_authority,
    profile::Profile,
    runtime::Decision,
};
use crossfire_contracts::{
    call::Call,
    operations::{Method, OperationId},
    origin::segment,
    runtime as wire, validation as check,
};
use crossfire_domain::runtime::values::{OptionChoice, Question};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Pending,
    Responded,
    Cancelled,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    id: String,
    native: String,
    status: Status,
}
struct State {
    receipts: Vec<Receipt>,
    pending: BTreeSet<String>,
    error: Option<Failure>,
}
struct Pending<'a, S: LocalState> {
    state: &'a Mutex<State>,
    storage: &'a S,
    file: &'a str,
    id: String,
    native: String,
    offered: bool,
}
impl<S: LocalState> Drop for Pending<'_, S> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.pending.remove(&self.native);
            if !self.offered {
                for receipt in &mut state.receipts {
                    if receipt.id == self.id && receipt.status == Status::Pending {
                        receipt.status = Status::Cancelled;
                    }
                }
            }
            if let Err(error) =
                local_state::write(self.storage, self.file, &state.receipts, 1048576)
            {
                state.error = Some(error);
            }
        }
    }
}
pub struct Broker<S, C, M, T> {
    pub storage: Arc<S>,
    pub coordination: Arc<C>,
    pub matrix: Arc<M>,
    pub clock: T,
    pub profile: Profile,
    file: String,
    state: Mutex<State>,
    reporting: watch::Receiver<Option<String>>,
    lifetime: CancellationToken,
}
fn key(decision: &Decision) -> String {
    json!([
        decision.runtime.code(),
        decision.session_id,
        decision.request_id
    ])
    .to_string()
}
impl<S: LocalState, C: Coordination, M: Matrix, T: Clock + Send + Sync> Broker<S, C, M, T> {
    pub fn open(
        storage: Arc<S>,
        coordination: Arc<C>,
        matrix: Arc<M>,
        clock: T,
        profile: Profile,
        file: &str,
        reporting: watch::Receiver<Option<String>>,
    ) -> Result<Self> {
        let mut receipts: Vec<Receipt> =
            local_state::read(storage.as_ref(), file, 1048576)?.unwrap_or_default();
        let mut ids = BTreeSet::new();
        if receipts.len() > 4096 {
            return Err(invalid("Native decision receipts exceed their capacity"));
        }
        for receipt in &mut receipts {
            check::identifier(&json!(receipt.id))?;
            check::text(&json!(receipt.native), 1, 1000)?;
            if !ids.insert(&receipt.id) {
                return Err(invalid("Duplicate retained native decision identity"));
            }
            if receipt.status == Status::Pending {
                receipt.status = Status::Cancelled;
            }
        }
        local_state::write(storage.as_ref(), file, &receipts, 1048576)?;
        Ok(Self {
            storage,
            coordination,
            matrix,
            clock,
            profile,
            file: file.to_owned(),
            state: Mutex::new(State {
                receipts,
                pending: BTreeSet::new(),
                error: None,
            }),
            reporting,
            lifetime: CancellationToken::new(),
        })
    }
    fn save(&self, state: &State) -> Result<()> {
        local_state::write(self.storage.as_ref(), &self.file, &state.receipts, 1048576)
    }
    pub fn unresolved(&self) -> Result<bool> {
        let state = self
            .state
            .lock()
            .map_err(|_| invalid("Decision receipt ownership failed"))?;
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        Ok(state
            .receipts
            .iter()
            .any(|receipt| receipt.status == Status::Pending))
    }
    pub fn responded(&self, decision: &Decision) -> Result<()> {
        let key = key(decision);
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Decision receipt ownership failed"))?;
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        for receipt in &mut state.receipts {
            if receipt.native == key && receipt.status == Status::Pending {
                receipt.status = Status::Responded;
            }
        }
        self.save(&state)
    }
    pub async fn flush(&self, stop: CancellationToken) -> Result<()> {
        self.unresolved()?;
        let pending: Vec<_> = self
            .state
            .lock()
            .map_err(|_| invalid("Decision receipt ownership failed"))?
            .receipts
            .iter()
            .filter(|receipt| receipt.status != Status::Pending)
            .cloned()
            .collect();
        for receipt in pending {
            let mut call = Call::agent(OperationId::ReceiptRuntimeDecision, &self.profile.id);
            call.parameters
                .insert("decisionId".to_owned(), receipt.id.clone());
            call.body = Some(
                json!({"status":match receipt.status { Status::Responded => "responded", Status::Cancelled => "cancelled", Status::Pending => return Err(invalid("Unsettled decision cannot be acknowledged")) }}),
            );
            match self.coordination.call(&call, stop.clone()).await {
                Ok(_) => {}
                Err(error) if matches!(error.code, ErrorCode::Missing | ErrorCode::Conflict) => {}
                Err(error) => return Err(error),
            }
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Decision receipt ownership failed"))?;
            state.receipts.retain(|value| value.id != receipt.id);
            self.save(&state)?;
        }
        Ok(())
    }
    pub async fn request(&self, decision: &Decision, stop: CancellationToken) -> Result<Value> {
        self.unresolved()?;
        if self.lifetime.is_cancelled() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Native decisions are closed",
            ));
        }
        let duration = decision
            .expires_ms
            .map(u64::try_from)
            .transpose()
            .map_err(|_| invalid("Native decision expiry cannot be negative"))?;
        let expires_at = decision
            .expires_ms
            .map(|duration| {
                self.clock.now().and_then(|now| {
                    now.checked_add(duration)
                        .ok_or_else(|| invalid("Native decision expiry overflow"))
                })
            })
            .transpose()?;
        let turn = decision
            .turn_id
            .as_deref()
            .ok_or_else(|| invalid("Native decisions require their original turn identity"))?;
        let item = decision
            .item_id
            .as_deref()
            .ok_or_else(|| invalid("Native decisions require their original item identity"))?;
        check::text(&json!(turn), 1, 255)?;
        check::text(&json!(item), 1, 255)?;
        let native = key(decision);
        let id = identity::id();
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Decision receipt ownership failed"))?;
            if state.receipts.len() >= 4096 {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Native decision receipt capacity reached; original decisions remain retained",
                ));
            }
            if !state.pending.insert(native.clone()) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "This exact native decision is already pending",
                ));
            }
            state.receipts.push(Receipt {
                id: id.clone(),
                native: native.clone(),
                status: Status::Pending,
            });
            if let Err(error) = self.save(&state) {
                state.pending.remove(&native);
                if let Some(receipt) = state.receipts.iter_mut().find(|receipt| receipt.id == id) {
                    receipt.status = Status::Cancelled;
                }
                state.error = Some(error.clone());
                if let Err(retained) = self.save(&state) {
                    state.error = Some(retained);
                }
                return Err(error);
            }
        }
        let mut pending = Pending {
            state: &self.state,
            storage: self.storage.as_ref(),
            file: &self.file,
            id: id.clone(),
            native,
            offered: false,
        };
        let scope = self.lifetime.child_token();
        let expires = async {
            if let Some(milliseconds) = duration {
                tokio::time::sleep(Duration::from_millis(milliseconds)).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        let result = tokio::select! { biased;
            _ = stop.cancelled() => Err(Failure::new(ErrorCode::Unavailable, "Native decision cancelled without a response")),
            _ = scope.cancelled() => Err(Failure::new(ErrorCode::Unavailable, "Native decision owner stopped")),
            _ = expires => Err(Failure::new(ErrorCode::Conflict, "The native decision expired without a response")),
            result = self.offer(decision, &id, turn, item, expires_at, scope.clone()) => result,
        };
        scope.cancel();
        pending.offered = result.is_ok();
        drop(pending);
        self.unresolved()?;
        result
    }
    pub async fn close(&self, stop: CancellationToken) -> Result<()> {
        self.lifetime.cancel();
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Decision receipt ownership failed"))?;
            for receipt in &mut state.receipts {
                if receipt.status == Status::Pending {
                    receipt.status = Status::Cancelled;
                }
            }
            self.save(&state)?;
        }
        self.flush(stop).await
    }
    async fn offer(
        &self,
        decision: &Decision,
        id: &str,
        turn: &str,
        item: &str,
        expires_at: Option<i64>,
        stop: CancellationToken,
    ) -> Result<Value> {
        let mut reporting = self.reporting.clone();
        let run = loop {
            if let Some(run) = reporting.borrow_and_update().clone() {
                break run;
            }
            reporting.changed().await.map_err(|_| {
                Failure::new(ErrorCode::Unavailable, "Listener reporting is not ready")
            })?;
        };
        owner_authority::authorize(
            self.coordination.as_ref(),
            self.matrix.as_ref(),
            &self.profile,
            stop.clone(),
        )
        .await?;
        let questions = decision.questions.clone().unwrap_or_else(|| {
            vec![Question {
                id: "decision".to_owned(),
                title: decision.action.clone(),
                prompt: "Review the complete native scope before selecting a choice.".to_owned(),
                secret: false,
                allow_text: false,
                options: decision
                    .choices
                    .iter()
                    .enumerate()
                    .map(|(index, choice)| OptionChoice {
                        id: index.to_string(),
                        label: choice.label.clone(),
                        description: String::new(),
                    })
                    .collect(),
            }]
        });
        let questions_wire: Vec<_> = questions.iter().map(|question| json!({"id":question.id,"title":question.title,"prompt":question.prompt,"secret":question.secret,"allowText":question.allow_text,"options":question.options.iter().map(|option| json!({"id":option.id,"label":option.label,"description":option.description})).collect::<Vec<_>>()})).collect();
        let body = json!({"id":id,"runId":run,"runtime":decision.runtime.code(),"sessionId":decision.session_id,"requestId":decision.request_id,"turnId":turn,"itemId":item,"kind":if decision.questions.is_some() { "question" } else { "permission" },"action":decision.action,"review":serde_json::to_string_pretty(&decision.scope).map_err(|_| invalid("Native decision review cannot be encoded"))?,"blocking":decision.blocking.unwrap_or(true),"expiresAt":expires_at,"questions":questions_wire});
        wire::decision(&body)?;
        let mut create = Call::agent(OperationId::CreateRuntimeDecision, &self.profile.id);
        create.body = Some(body);
        self.coordination.call(&create, stop.clone()).await?;
        let room = owner_authority::conversation(
            self.coordination.as_ref(),
            self.matrix.as_ref(),
            &self.profile,
            stop.clone(),
        )
        .await?;
        let page = format!(
            "{}/manage/agents/{}/decisions/{id}",
            self.coordination.origin(),
            self.profile.id
        );
        let links = if questions.len() == 1 {
            questions[0]
                .options
                .iter()
                .map(|option| format!("{}: {page}?choice={}", option.label, segment(&option.id)))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            String::new()
        };
        let notice = format!(
            "{}: review and answer at {page}.\n\n{}\n\n{links}\n\nLinks only open a review. Submit explicitly. The native request remains unanswered until you submit.",
            decision.action,
            questions
                .iter()
                .map(|question| format!("{}: {}", question.title, question.prompt))
                .collect::<Vec<_>>()
                .join("\n\n")
        );
        let mut position = 0;
        let mut remainder = notice.as_str();
        while !remainder.is_empty() {
            let mut end = remainder.len().min(12000);
            while !remainder.is_char_boundary(end) {
                end -= 1;
            }
            let mut message = Request::new(
                Method::Put,
                format!(
                    "{API}/rooms/{}/send/m.room.message/{id}-{position}",
                    segment(&room)
                ),
            );
            message.body = Some(
                json!({"msgtype":"m.notice","body":&remainder[..end],"org.crossfire.listener_notice":true}),
            );
            matrix::request(self.matrix.as_ref(), &message, stop.clone()).await?;
            remainder = &remainder[end..];
            position += 1;
        }
        loop {
            if let Some(expiry) = expires_at
                && self.clock.now()? >= expiry
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "The native decision expired without a response",
                ));
            }
            let mut poll = Call::agent(OperationId::PollRuntimeDecision, &self.profile.id);
            poll.parameters
                .insert("decisionId".to_owned(), id.to_owned());
            let answer = self.coordination.call(&poll, stop.clone()).await?;
            match answer.get("status").and_then(Value::as_str) {
                Some("answered") => {
                    owner_authority::authorize(
                        self.coordination.as_ref(),
                        self.matrix.as_ref(),
                        &self.profile,
                        stop,
                    )
                    .await?;
                    return answer_value(decision, &questions, &answer);
                }
                Some("pending") => tokio::time::sleep(Duration::from_secs(1)).await,
                _ => {
                    return Err(Failure::new(
                        ErrorCode::Conflict,
                        "Original native request is no longer pending",
                    ));
                }
            }
        }
    }
}
fn answer_value(decision: &Decision, questions: &[Question], source: &Value) -> Result<Value> {
    let rows = source
        .get("answers")
        .ok_or_else(|| invalid("Native decision has no answer rows"))?;
    let answers = wire::answers(&json!({"answers":rows}))?;
    if answers.len() != questions.len()
        || answers
            .iter()
            .map(|answer| &answer.question_id)
            .collect::<BTreeSet<_>>()
            .len()
            != answers.len()
    {
        return Err(invalid("Native answers are incomplete or duplicated"));
    }
    if decision.questions.is_none() {
        let answer = &answers[0];
        let selected = answer
            .option_id
            .as_deref()
            .ok_or_else(|| invalid("Native permission requires a selected choice"))?;
        let index = selected
            .parse::<usize>()
            .map_err(|_| invalid("Native permission choice is invalid"))?;
        if answer.question_id != "decision"
            || answer.text.is_some()
            || index.to_string() != selected
        {
            return Err(invalid(
                "Native permission answer does not match its original choice",
            ));
        }
        return decision
            .choices
            .get(index)
            .map(|choice| choice.value.clone())
            .ok_or_else(|| invalid("Native permission choice was not offered"));
    }
    let mut response = serde_json::Map::new();
    for question in questions {
        let answer = answers
            .iter()
            .find(|answer| answer.question_id == question.id)
            .ok_or_else(|| invalid("Native answer is for another question"))?;
        let text = match (&answer.text, &answer.option_id) {
            (Some(text), None) if question.allow_text => text.clone(),
            (None, Some(option)) => question
                .options
                .iter()
                .find(|choice| &choice.id == option)
                .map(|choice| choice.label.clone())
                .ok_or_else(|| invalid("Native question choice was not offered"))?,
            _ => return Err(invalid("Native question did not offer this answer form")),
        };
        response.insert(question.id.clone(), json!({"answers":[text]}));
    }
    Ok(json!({"answers":response}))
}
