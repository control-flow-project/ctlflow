use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_adapter_schedule::Calculator;
use crossfire_contracts::{validation as check, wake_up as wire};
use crossfire_domain::wake_up::{delivery, manage, read, values::*};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
fn encoded<T: serde::Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Wake-up response cannot be encoded"))
}
pub fn list(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let filter = ListFilter {
        owner_id: context.query.identifier("ownerId")?,
        search: context.query.search()?,
        page: page.page,
        page_size: page.size,
    };
    let values = context.with(|repo, now| read::list(repo, context.actor()?, &filter, now))?;
    reply::page(values, |value| encoded(wire::SummaryView::from(value)))
}
pub fn read(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context
        .with(|repo, now| read::read(repo, context.actor()?, context.parameter("ruleId")?, now))?;
    reply::of(wire::DetailsView::from(&value))
}
pub fn create(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let (id, input) = wire::creation(&context.input)?;
    let value = context.with(|repo, now| {
        manage::save(
            repo,
            &Calculator,
            context.actor()?,
            &Change {
                rule_id: &id,
                input: &input,
                expected_revision: None,
                request_id: &context.request_id,
                now,
            },
        )
    })?;
    reply::of(wire::DetailsView::from(&value))
}
pub fn change(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let (revision, input) = wire::change(&context.input)?;
    let value = context.with(|repo, now| {
        manage::save(
            repo,
            &Calculator,
            context.actor()?,
            &Change {
                rule_id: context.parameter("ruleId")?,
                input: &input,
                expected_revision: Some(revision),
                request_id: &context.request_id,
                now,
            },
        )
    })?;
    reply::of(wire::DetailsView::from(&value))
}
pub fn delete(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let revision = wire::removal(&context.input)?;
    context.with(|repo, now| {
        manage::remove(
            repo,
            context.actor()?,
            context.parameter("ruleId")?,
            revision,
            &context.request_id,
            now,
        )
    })?;
    reply::of(json!({"deleted":true}))
}
fn attachment(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Attachment> {
    Ok(Attachment {
        run_id: context
            .query
            .identifier("runId")?
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Wake-up attachment requires a runId"))?
            .to_owned(),
        session_id: check::text(&json!(context.query.get("sessionId").unwrap_or("")), 1, 255)?
            .to_owned(),
    })
}
pub fn metadata(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = attachment(context)?;
    let value = context.with(|repo, now| {
        delivery::metadata(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            &input,
            now,
        )
    })?;
    reply::of(wire::MetadataView(&value))
}
pub fn claim(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = wire::attachment(&context.input)?;
    let value = context.with(|repo, now| {
        delivery::claim(
            repo,
            &Calculator,
            context.actor()?,
            context.parameter("agentId")?,
            &input,
            now,
        )
    })?;
    reply::of(value.as_ref().map(wire::ScheduledView))
}
pub fn validate(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = attachment(context)?;
    let eligible = context.with(|repo, now| {
        delivery::validate(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("deliveryId")?,
            &input,
            now,
        )
    })?;
    reply::of(json!({"eligible":eligible}))
}
pub fn acknowledge(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = wire::attachment(&context.input)?;
    let recorded = context.with(|repo, now| {
        delivery::acknowledge(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("deliveryId")?,
            &input,
            now,
        )
    })?;
    reply::of(json!({"recorded":recorded}))
}
