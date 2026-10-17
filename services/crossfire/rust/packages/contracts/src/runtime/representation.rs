use crossfire_domain::runtime::values::*;
use serde::{
    Serialize, Serializer,
    ser::{SerializeSeq, SerializeStruct},
};

pub struct SummaryWire<'a>(pub &'a DecisionSummary);
pub struct DecisionWire<'a>(pub &'a Decision);
pub struct ObservationWire<'a>(pub &'a ObservationView);
pub struct AnswersWire<'a>(pub &'a [Answer]);
struct QuestionsWire<'a>(&'a [Question]);
struct OptionsWire<'a>(&'a [OptionChoice]);
struct SettingsWire<'a>(&'a [Setting]);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HeaderWire<'a> {
    id: &'a str,
    run_id: &'a str,
    runtime: &'a str,
    session_id: &'a str,
    request_id: &'a str,
    turn_id: &'a str,
    item_id: &'a str,
    kind: &'a str,
    action: &'a str,
    blocking: bool,
    expires_at: Option<i64>,
}

impl<'a> From<&'a DecisionHeader> for HeaderWire<'a> {
    fn from(value: &'a DecisionHeader) -> Self {
        Self {
            id: &value.id,
            run_id: &value.run_id,
            runtime: value.runtime.code(),
            session_id: &value.session_id,
            request_id: &value.request_id,
            turn_id: &value.turn_id,
            item_id: &value.item_id,
            kind: value.kind.code(),
            action: &value.action,
            blocking: value.blocking,
            expires_at: value.expires_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryFields<'a> {
    #[serde(flatten)]
    header: HeaderWire<'a>,
    agent_id: &'a str,
    status: &'a str,
    created_at: i64,
}

impl<'a> From<&'a DecisionSummary> for SummaryFields<'a> {
    fn from(value: &'a DecisionSummary) -> Self {
        Self {
            header: (&value.header).into(),
            agent_id: &value.agent_id,
            status: value.status.code(),
            created_at: value.created_at,
        }
    }
}

impl Serialize for SummaryWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        SummaryFields::from(self.0).serialize(serializer)
    }
}

impl Serialize for DecisionWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct View<'a> {
            #[serde(flatten)]
            summary: SummaryFields<'a>,
            review: &'a str,
            questions: QuestionsWire<'a>,
        }
        View {
            summary: (&self.0.summary).into(),
            review: &self.0.review,
            questions: QuestionsWire(&self.0.questions),
        }
        .serialize(serializer)
    }
}

impl Serialize for QuestionsWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct View<'a> {
            id: &'a str,
            title: &'a str,
            prompt: &'a str,
            secret: bool,
            allow_text: bool,
            options: OptionsWire<'a>,
        }
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for question in self.0 {
            sequence.serialize_element(&View {
                id: &question.id,
                title: &question.title,
                prompt: &question.prompt,
                secret: question.secret,
                allow_text: question.allow_text,
                options: OptionsWire(&question.options),
            })?;
        }
        sequence.end()
    }
}

impl Serialize for OptionsWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct View<'a> {
            id: &'a str,
            label: &'a str,
            description: &'a str,
        }
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for option in self.0 {
            sequence.serialize_element(&View {
                id: &option.id,
                label: &option.label,
                description: &option.description,
            })?;
        }
        sequence.end()
    }
}

impl Serialize for AnswersWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct View<'a> {
            question_id: &'a str,
            option_id: &'a Option<String>,
            text: &'a Option<String>,
        }
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for answer in self.0 {
            sequence.serialize_element(&View {
                question_id: &answer.question_id,
                option_id: &answer.option_id,
                text: &answer.text,
            })?;
        }
        sequence.end()
    }
}

impl Serialize for SettingsWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct View<'a> {
            name: &'a str,
            configured: &'a Option<String>,
            effective: &'a Option<String>,
        }
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for setting in self.0 {
            sequence.serialize_element(&View {
                name: &setting.name,
                configured: &setting.configured,
                effective: &setting.effective,
            })?;
        }
        sequence.end()
    }
}

impl Serialize for ObservationWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let value = &self.0.observation;
        let mut view = serializer.serialize_struct("RuntimeObservation", 12)?;
        view.serialize_field("runId", &self.0.run_id)?;
        view.serialize_field("sessionId", &value.session_id)?;
        view.serialize_field("roomId", &value.room_id)?;
        view.serialize_field("runtime", value.runtime.code())?;
        view.serialize_field("state", value.state.code())?;
        view.serialize_field("observedAt", &value.observed_at)?;
        view.serialize_field("lastActivityAt", &value.last_activity_at)?;
        view.serialize_field("historyAvailable", &value.history_available)?;
        view.serialize_field("historyMode", value.history_mode.code())?;
        view.serialize_field("maxInputBytes", &value.max_input_bytes)?;
        view.serialize_field("settings", &SettingsWire(&value.settings))?;
        view.serialize_field("errorMessage", &value.error_message)?;
        view.end()
    }
}
