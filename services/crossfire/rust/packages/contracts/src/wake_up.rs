use crate::{identity::PrincipalView, validation as check};
use crossfire_domain::{
    schedule::Schedule,
    wake_up::values::{Attachment, Details, Input, Metadata, ScheduledWake, Summary},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Serialize, Serializer, ser::SerializeStruct};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub fn schedule(value: &Value) -> Result<Schedule> {
    match value.get("kind").and_then(Value::as_str) {
        Some("interval") => {
            let value = check::object(value, &["kind", "seconds"], &[])?;
            Ok(Schedule::Interval {
                seconds: check::integer(&value["seconds"], 1, 31_536_000)?,
            })
        }
        Some("cron") => {
            let value = check::object(value, &["kind", "expression", "timeZone"], &[])?;
            Ok(Schedule::Cron {
                expression: check::text(&value["expression"], 1, 200)?.to_owned(),
                time_zone: check::text(&value["timeZone"], 1, 100)?.to_owned(),
            })
        }
        _ => Err(Failure::new(
            ErrorCode::Invalid,
            "Choose an interval or calendar schedule",
        )),
    }
}

fn fields(value: &Map<String, Value>) -> Result<Input> {
    let name = check::text(&value["name"], 1, 100)?;
    let message = check::plain_text(&value["message"], 16_384)?;
    if name.trim_matches(check::whitespace).is_empty()
        || message.trim_matches(check::whitespace).is_empty()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Provide a Wake-up name and message",
        ));
    }
    let agent_ids = check::list(&value["agentIds"], 0, 1000)?
        .iter()
        .map(|value| check::identifier(value).map(str::to_owned))
        .collect::<Result<Vec<_>>>()?;
    if agent_ids.iter().collect::<BTreeSet<_>>().len() != agent_ids.len() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate attached agents",
        ));
    }
    Ok(Input {
        name: name.to_owned(),
        message: message.to_owned(),
        schedule: schedule(&value["schedule"])?,
        enabled: check::boolean(&value["enabled"])?,
        agent_ids,
    })
}

pub fn creation(value: &Value) -> Result<(String, Input)> {
    let value = check::object(
        value,
        &[
            "ruleId", "name", "message", "schedule", "enabled", "agentIds",
        ],
        &[],
    )?;
    Ok((
        check::identifier(&value["ruleId"])?.to_owned(),
        fields(value)?,
    ))
}

pub fn change(value: &Value) -> Result<(i64, Input)> {
    let value = check::object(
        value,
        &[
            "expectedRevision",
            "name",
            "message",
            "schedule",
            "enabled",
            "agentIds",
        ],
        &[],
    )?;
    Ok((
        check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        fields(value)?,
    ))
}

pub fn removal(value: &Value) -> Result<i64> {
    let value = check::object(value, &["expectedRevision"], &[])?;
    check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)
}

pub fn attachment(value: &Value) -> Result<Attachment> {
    let value = check::object(value, &["runId", "sessionId"], &[])?;
    Ok(Attachment {
        run_id: check::identifier(&value["runId"])?.to_owned(),
        session_id: check::text(&value["sessionId"], 1, 200)?.to_owned(),
    })
}

pub struct ScheduleView<'a>(pub &'a Schedule);
impl Serialize for ScheduleView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self.0 {
            Schedule::Interval { seconds } => {
                let mut value = serializer.serialize_struct("Schedule", 2)?;
                value.serialize_field("kind", "interval")?;
                value.serialize_field("seconds", seconds)?;
                value.end()
            }
            Schedule::Cron {
                expression,
                time_zone,
            } => {
                let mut value = serializer.serialize_struct("Schedule", 3)?;
                value.serialize_field("kind", "cron")?;
                value.serialize_field("expression", expression)?;
                value.serialize_field("timeZone", time_zone)?;
                value.end()
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryView<'a> {
    rule_id: &'a str,
    owner: PrincipalView<'a>,
    configured_by_id: &'a str,
    name: &'a str,
    message: &'a str,
    schedule: ScheduleView<'a>,
    enabled: bool,
    revision: i64,
    created_at: i64,
    updated_at: i64,
    agent_count: usize,
    next_due_at: Option<i64>,
    last_delivered_at: Option<i64>,
}

impl<'a> From<&'a Summary> for SummaryView<'a> {
    fn from(value: &'a Summary) -> Self {
        Self {
            rule_id: &value.rule.id,
            owner: PrincipalView(&value.owner),
            configured_by_id: &value.rule.configured_by_id,
            name: &value.rule.name,
            message: &value.rule.message,
            schedule: ScheduleView(&value.rule.schedule),
            enabled: value.rule.enabled,
            revision: value.rule.revision,
            created_at: value.rule.created_at,
            updated_at: value.rule.updated_at,
            agent_count: value.agent_count,
            next_due_at: value.next_due_at,
            last_delivered_at: value.last_delivered_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailsView<'a> {
    #[serde(flatten)]
    summary: SummaryView<'a>,
    agents: Vec<AssignedView<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssignedView<'a> {
    #[serde(flatten)]
    principal: PrincipalView<'a>,
    rule_id: &'a str,
    agent_id: &'a str,
    next_due_at: i64,
    last_delivered_at: Option<i64>,
}

impl<'a> From<&'a Details> for DetailsView<'a> {
    fn from(value: &'a Details) -> Self {
        Self {
            summary: SummaryView::from(&value.summary),
            agents: value
                .agents
                .iter()
                .map(|(principal, assignment)| AssignedView {
                    principal: PrincipalView(principal),
                    rule_id: &assignment.rule_id,
                    agent_id: &assignment.agent_id,
                    next_due_at: assignment.next_due_at,
                    last_delivered_at: assignment.last_delivered_at,
                })
                .collect(),
        }
    }
}

pub struct MetadataView<'a>(pub &'a Metadata);
impl Serialize for MetadataView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("Metadata", 2)?;
        value.serialize_field("now", &self.0.now)?;
        value.serialize_field("nextDueAt", &self.0.next_due_at)?;
        value.end()
    }
}

pub struct ScheduledView<'a>(pub &'a ScheduledWake);
impl Serialize for ScheduledView<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("ScheduledWake", 9)?;
        value.serialize_field("deliveryId", &self.0.delivery_id)?;
        value.serialize_field("ruleId", &self.0.rule_id)?;
        value.serialize_field("ruleRevision", &self.0.rule_revision)?;
        value.serialize_field("name", &self.0.name)?;
        value.serialize_field("message", &self.0.message)?;
        value.serialize_field("scheduledAt", &self.0.scheduled_at)?;
        value.serialize_field("sessionId", &self.0.session_id)?;
        value.serialize_field("ownerMatrixId", &self.0.owner_matrix_id)?;
        value.serialize_field("authorizerMatrixId", &self.0.authorizer_matrix_id)?;
        value.end()
    }
}
