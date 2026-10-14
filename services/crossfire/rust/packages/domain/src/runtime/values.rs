use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub const INPUT_BYTES: i64 = 65_536;
pub const MAX_INPUT_BYTES: i64 = 4 * 1024 * 1024;
pub const MAX_REVIEW_BYTES: usize = 8 * 1024 * 1024;

macro_rules! codes {
    ($name:ident, $($variant:ident => $code:literal),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub fn code(self) -> &'static str { match self { $(Self::$variant => $code),+ } }
            pub fn parse(value: &str) -> Result<Self> {
                match value { $($code => Ok(Self::$variant)),+,
                    _ => Err(Failure::new(ErrorCode::Invalid, concat!("Invalid ", stringify!($name)))) }
            }
        }
    };
}

codes!(Runtime, Codex => "codex", Pi => "pi");
codes!(DecisionKind, Permission => "permission", Question => "question");
codes!(DecisionStatus, Pending => "pending", Answered => "answered", Responded => "responded", Cancelled => "cancelled", Expired => "expired");
codes!(HistoryMode, Shared => "shared", PerRoom => "per-room");
codes!(State, Idle => "idle", Working => "working", WaitingApproval => "waiting-approval", WaitingAnswer => "waiting-answer", Failed => "failed", Unavailable => "unavailable", Sleeping => "sleeping", Waking => "waking");
codes!(IncidentKind, Failure => "failure", Contact => "contact");
codes!(NotificationPhase, Initial => "initial", Recovery => "recovery");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionChoice {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Question {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub secret: bool,
    pub allow_text: bool,
    pub options: Vec<OptionChoice>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionHeader {
    pub id: String,
    pub run_id: String,
    pub runtime: Runtime,
    pub session_id: String,
    pub request_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub kind: DecisionKind,
    pub action: String,
    pub blocking: bool,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionRequest {
    pub header: DecisionHeader,
    pub review: String,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionSummary {
    pub header: DecisionHeader,
    pub agent_id: String,
    pub status: DecisionStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub summary: DecisionSummary,
    pub review: String,
    pub questions: Vec<Question>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Answer {
    pub question_id: String,
    pub option_id: Option<String>,
    pub text: Option<String>,
}

impl std::fmt::Debug for Answer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Answer")
            .field("question_id", &self.question_id)
            .field("answer", &"[redacted]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Setting {
    pub name: String,
    pub configured: Option<String>,
    pub effective: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub session_id: String,
    pub room_id: Option<String>,
    pub runtime: Runtime,
    pub state: State,
    pub observed_at: i64,
    pub last_activity_at: Option<i64>,
    pub history_available: Option<bool>,
    pub history_mode: HistoryMode,
    pub max_input_bytes: i64,
    pub settings: Vec<Setting>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationView {
    pub run_id: String,
    pub observation: Observation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SummaryState {
    Native(State),
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    pub state: SummaryState,
    pub observed_at: i64,
    pub last_activity_at: Option<i64>,
    pub history_available: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
pub struct StateMeasurement {
    pub state: State,
    pub observed_at: i64,
    pub last_activity_at: Option<i64>,
    pub history_available: Option<bool>,
}

impl From<&ObservationView> for StateMeasurement {
    fn from(value: &ObservationView) -> Self {
        Self {
            state: value.observation.state,
            observed_at: value.observation.observed_at,
            last_activity_at: value.observation.last_activity_at,
            history_available: value.observation.history_available,
        }
    }
}

fn priority(state: State) -> u8 {
    match state {
        State::Failed => 0,
        State::WaitingApproval => 1,
        State::WaitingAnswer => 2,
        State::Waking => 3,
        State::Working => 4,
        State::Unavailable => 5,
        State::Idle => 6,
        State::Sleeping => 7,
    }
}

pub fn summarize<T: Into<StateMeasurement>>(
    values: impl IntoIterator<Item = T>,
) -> Option<Summary> {
    let mut result: Option<Summary> = None;
    for value in values {
        let value = value.into();
        if let Some(summary) = &mut result {
            if let SummaryState::Native(state) = summary.state
                && priority(value.state) < priority(state)
            {
                summary.state = SummaryState::Native(value.state);
            }
            summary.observed_at = summary.observed_at.max(value.observed_at);
            summary.last_activity_at = summary.last_activity_at.max(value.last_activity_at);
            summary.history_available = match (summary.history_available, value.history_available) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            };
        } else {
            result = Some(Summary {
                state: SummaryState::Native(value.state),
                observed_at: value.observed_at,
                last_activity_at: value.last_activity_at,
                history_available: value.history_available,
            });
        }
    }
    result
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Incident {
    pub id: String,
    pub owner_id: String,
    pub agent_id: Option<String>,
    pub fleet_id: Option<String>,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub kind: IncidentKind,
    pub message: String,
    pub created_at: i64,
    pub recovered_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub incident_id: String,
    pub phase: NotificationPhase,
    pub body: String,
    pub next_attempt_at: i64,
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagementConversation {
    pub owner_id: String,
    pub room_id: String,
    pub created_at: i64,
}
