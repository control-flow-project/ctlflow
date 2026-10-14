use crate::tables::{wake_delivery, wake_rule, wake_rule_agent};
use crossfire_domain::{
    schedule::Schedule,
    wake_up::values::{Assignment, Delivery, DeliveryStatus, Rule},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = wake_rule, treat_none_as_null = true)]
pub(super) struct RuleRow {
    pub id: String,
    owner_id: String,
    configured_by_id: String,
    name: String,
    message: String,
    schedule_kind: String,
    interval_seconds: Option<i64>,
    cron_expression: Option<String>,
    time_zone: Option<String>,
    enabled: i64,
    revision: i64,
    created_at: i64,
    updated_at: i64,
}

impl From<&Rule> for RuleRow {
    fn from(value: &Rule) -> Self {
        let (kind, interval, expression, zone) = match &value.schedule {
            Schedule::Interval { seconds } => ("interval", Some(*seconds), None, None),
            Schedule::Cron {
                expression,
                time_zone,
            } => (
                "cron",
                None,
                Some(expression.clone()),
                Some(time_zone.clone()),
            ),
        };
        Self {
            id: value.id.clone(),
            owner_id: value.owner_id.clone(),
            configured_by_id: value.configured_by_id.clone(),
            name: value.name.clone(),
            message: value.message.clone(),
            schedule_kind: kind.to_owned(),
            interval_seconds: interval,
            cron_expression: expression,
            time_zone: zone,
            enabled: i64::from(value.enabled),
            revision: value.revision,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl TryFrom<RuleRow> for Rule {
    type Error = Failure;
    fn try_from(value: RuleRow) -> Result<Self> {
        let schedule = match (
            value.schedule_kind.as_str(),
            value.interval_seconds,
            value.cron_expression,
            value.time_zone,
        ) {
            ("interval", Some(seconds), None, None) if (1..=31_536_000).contains(&seconds) => {
                Schedule::Interval { seconds }
            }
            ("cron", None, Some(expression), Some(time_zone)) => Schedule::Cron {
                expression,
                time_zone,
            },
            _ => return Err(corrupt()),
        };
        let enabled = match value.enabled {
            0 => false,
            1 => true,
            _ => return Err(corrupt()),
        };
        Ok(Self {
            id: value.id,
            owner_id: value.owner_id,
            configured_by_id: value.configured_by_id,
            name: value.name,
            message: value.message,
            schedule,
            enabled,
            revision: value.revision,
            created_at: value.created_at,
            updated_at: value.updated_at,
        })
    }
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = wake_rule_agent, treat_none_as_null = true)]
pub(super) struct AssignmentRow {
    pub rule_id: String,
    pub agent_id: String,
    pub next_due_at: i64,
    pub last_delivered_at: Option<i64>,
}

impl From<&Assignment> for AssignmentRow {
    fn from(value: &Assignment) -> Self {
        Self {
            rule_id: value.rule_id.clone(),
            agent_id: value.agent_id.clone(),
            next_due_at: value.next_due_at,
            last_delivered_at: value.last_delivered_at,
        }
    }
}

impl From<AssignmentRow> for Assignment {
    fn from(value: AssignmentRow) -> Self {
        Self {
            rule_id: value.rule_id,
            agent_id: value.agent_id,
            next_due_at: value.next_due_at,
            last_delivered_at: value.last_delivered_at,
        }
    }
}

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = wake_delivery)]
pub(super) struct DeliveryRow {
    id: String,
    rule_id: String,
    agent_id: String,
    rule_revision: i64,
    run_id: String,
    session_id: String,
    scheduled_at: i64,
    created_at: i64,
    status: String,
    delivered_at: Option<i64>,
}

pub(super) fn status(value: DeliveryStatus) -> &'static str {
    match value {
        DeliveryStatus::Pending => "pending",
        DeliveryStatus::Delivered => "delivered",
        DeliveryStatus::Cancelled => "cancelled",
    }
}

impl From<&Delivery> for DeliveryRow {
    fn from(value: &Delivery) -> Self {
        Self {
            id: value.id.clone(),
            rule_id: value.rule_id.clone(),
            agent_id: value.agent_id.clone(),
            rule_revision: value.rule_revision,
            run_id: value.run_id.clone(),
            session_id: value.session_id.clone(),
            scheduled_at: value.scheduled_at,
            created_at: value.created_at,
            status: status(value.status).to_owned(),
            delivered_at: value.delivered_at,
        }
    }
}

impl TryFrom<DeliveryRow> for Delivery {
    type Error = Failure;
    fn try_from(value: DeliveryRow) -> Result<Self> {
        let status = match value.status.as_str() {
            "pending" => DeliveryStatus::Pending,
            "delivered" => DeliveryStatus::Delivered,
            "cancelled" => DeliveryStatus::Cancelled,
            _ => return Err(corrupt()),
        };
        Ok(Self {
            id: value.id,
            rule_id: value.rule_id,
            agent_id: value.agent_id,
            rule_revision: value.rule_revision,
            run_id: value.run_id,
            session_id: value.session_id,
            scheduled_at: value.scheduled_at,
            created_at: value.created_at,
            status,
            delivered_at: value.delivered_at,
        })
    }
}

fn corrupt() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Stored Wake-up state is invalid")
}
