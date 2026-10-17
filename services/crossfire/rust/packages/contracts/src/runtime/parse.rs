use crate::validation as check;
use crossfire_domain::runtime::values::*;
use crossfire_kernel::Result;
use serde_json::{Map, Value};

fn field<T>(
    object: &Map<String, Value>,
    name: &str,
    parse: impl FnOnce(&Value) -> Result<T>,
) -> Result<T> {
    parse(&object[name]).map_err(|error| error.field(name))
}
fn string(object: &Map<String, Value>, name: &str, maximum: usize) -> Result<String> {
    field(object, name, |value| {
        check::text(value, 1, maximum).map(str::to_owned)
    })
}
fn optional<T>(value: &Value, parse: impl FnOnce(&Value) -> Result<T>) -> Result<Option<T>> {
    if value.is_null() {
        Ok(None)
    } else {
        parse(value).map(Some)
    }
}
fn timestamp(value: &Value) -> Result<i64> {
    check::integer(value, 0, check::SAFE_INTEGER)
}

pub fn question(value: &Value) -> Result<Question> {
    let object = check::object(
        value,
        &["id", "title", "prompt", "secret", "allowText", "options"],
        &[],
    )?;
    let options = field(object, "options", |value| {
        check::list(value, 0, 100)?
            .iter()
            .map(|value| {
                let object = check::object(value, &["id", "label", "description"], &[])?;
                Ok(OptionChoice {
                    id: string(object, "id", 255)?,
                    label: string(object, "label", 1000)?,
                    description: field(object, "description", |value| {
                        check::plain_text(value, 4000).map(str::to_owned)
                    })?,
                })
            })
            .collect::<Result<Vec<_>>>()
    })?;
    Ok(Question {
        id: string(object, "id", 255)?,
        title: string(object, "title", 1000)?,
        prompt: field(object, "prompt", |value| {
            check::plain_text(value, 16000).map(str::to_owned)
        })?,
        secret: field(object, "secret", check::boolean)?,
        allow_text: field(object, "allowText", check::boolean)?,
        options,
    })
}

pub fn decision(value: &Value) -> Result<DecisionRequest> {
    let object = check::object(
        value,
        &[
            "id",
            "runId",
            "runtime",
            "sessionId",
            "requestId",
            "turnId",
            "itemId",
            "kind",
            "action",
            "review",
            "blocking",
            "expiresAt",
            "questions",
        ],
        &[],
    )?;
    Ok(DecisionRequest {
        header: DecisionHeader {
            id: field(object, "id", |value| {
                check::identifier(value).map(str::to_owned)
            })?,
            run_id: field(object, "runId", |value| {
                check::identifier(value).map(str::to_owned)
            })?,
            runtime: field(object, "runtime", |value| {
                Runtime::parse(check::choice(value, &["codex", "pi"])?)
            })?,
            session_id: string(object, "sessionId", 255)?,
            request_id: string(object, "requestId", 255)?,
            turn_id: string(object, "turnId", 255)?,
            item_id: string(object, "itemId", 255)?,
            kind: field(object, "kind", |value| {
                DecisionKind::parse(check::choice(value, &["permission", "question"])?)
            })?,
            action: string(object, "action", 255)?,
            blocking: field(object, "blocking", check::boolean)?,
            expires_at: field(object, "expiresAt", |value| optional(value, timestamp))?,
        },
        review: field(object, "review", |value| {
            check::plain_text(value, MAX_REVIEW_BYTES).map(str::to_owned)
        })?,
        questions: field(object, "questions", |value| {
            check::list(value, 1, 100)?
                .iter()
                .map(question)
                .collect::<Result<Vec<_>>>()
        })?,
    })
}

pub fn answers(value: &Value) -> Result<Vec<Answer>> {
    let object = check::object(value, &["answers"], &[])?;
    field(object, "answers", |value| {
        check::list(value, 1, 100)?
            .iter()
            .map(|value| {
                let object = check::object(value, &["questionId", "optionId", "text"], &[])?;
                Ok(Answer {
                    question_id: string(object, "questionId", 255)?,
                    option_id: field(object, "optionId", |value| {
                        optional(value, |value| check::text(value, 1, 255).map(str::to_owned))
                    })?,
                    text: field(object, "text", |value| {
                        optional(value, |value| {
                            check::plain_text(value, 16000).map(str::to_owned)
                        })
                    })?,
                })
            })
            .collect::<Result<Vec<_>>>()
    })
}

pub fn observation(value: &Value) -> Result<Observation> {
    let object = check::object(
        value,
        &[
            "sessionId",
            "roomId",
            "runtime",
            "state",
            "observedAt",
            "lastActivityAt",
            "historyAvailable",
            "historyMode",
            "maxInputBytes",
            "settings",
            "errorMessage",
        ],
        &[],
    )?;
    let settings = field(object, "settings", |value| {
        check::list(value, 0, 100)?
            .iter()
            .map(|value| {
                let object = check::object(value, &["name", "configured", "effective"], &[])?;
                Ok(Setting {
                    name: string(object, "name", 100)?,
                    configured: field(object, "configured", |value| {
                        optional(value, |value| {
                            check::text(value, 1, 1000).map(str::to_owned)
                        })
                    })?,
                    effective: field(object, "effective", |value| {
                        optional(value, |value| {
                            check::text(value, 1, 1000).map(str::to_owned)
                        })
                    })?,
                })
            })
            .collect::<Result<Vec<_>>>()
    })?;
    Ok(Observation {
        session_id: string(object, "sessionId", 255)?,
        room_id: field(object, "roomId", |value| optional(value, check::room_id))?,
        runtime: field(object, "runtime", |value| {
            Runtime::parse(check::choice(value, &["codex", "pi"])?)
        })?,
        state: field(object, "state", |value| {
            State::parse(check::choice(
                value,
                &[
                    "idle",
                    "working",
                    "waiting-approval",
                    "waiting-answer",
                    "failed",
                    "unavailable",
                    "sleeping",
                    "waking",
                ],
            )?)
        })?,
        observed_at: field(object, "observedAt", timestamp)?,
        last_activity_at: field(object, "lastActivityAt", |value| optional(value, timestamp))?,
        history_available: field(object, "historyAvailable", |value| {
            optional(value, check::boolean)
        })?,
        history_mode: field(object, "historyMode", |value| {
            HistoryMode::parse(check::choice(value, &["shared", "per-room"])?)
        })?,
        max_input_bytes: field(object, "maxInputBytes", |value| {
            check::integer(value, 1024, MAX_INPUT_BYTES)
        })?,
        settings,
        error_message: field(object, "errorMessage", |value| {
            optional(value, |value| {
                check::plain_text(value, 4000).map(str::to_owned)
            })
        })?,
    })
}
