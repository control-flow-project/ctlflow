use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::{
    enrollment, fleet_control as wire, fleet_runtime, validation as check, views,
};
use crossfire_domain::{
    fleet::{control, manage, message, native_stop, retire, runtime},
    read,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::time::Duration;
pub fn list(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let owner = context.query.identifier("ownerId")?;
    let search = context.query.search()?;
    let values = context
        .with(|repo, now| read::fleet::list(repo, context.actor()?, owner, search, page, now))?;
    reply::page(values, |value| Ok(views::fleet(value)))
}
pub fn read(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let actor = context.auth.fleet()?;
    let value = context
        .with(|repo, now| read::fleet::read(repo, &actor, context.parameter("fleetId")?, now))?;
    reply::of(views::fleet(&value))
}
pub fn agents(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let actor = context.auth.fleet()?;
    let values = context.with(|repo, now| {
        read::fleet::agents(repo, &actor, context.parameter("fleetId")?, page, now)
    })?;
    reply::page(values, |(key, agent)| {
        Ok(json!({"instanceKey":key,"agent":views::agent(agent)}))
    })
}
pub fn change(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(
        &context.input,
        &["expectedRevision", "label", "controller"],
        &[],
    )?;
    let descriptor = enrollment::controller(&value["controller"])?;
    let input = manage::Change {
        expected_revision: check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        label: check::text(&value["label"], 1, 100)?,
        controller_name: &descriptor.name,
        metadata: &descriptor.metadata,
    };
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        manage::change(
            repo,
            &actor,
            context.parameter("fleetId")?,
            input,
            &context.request_id,
            now,
        )
    })?;
    reply::of(views::fleet(&value))
}
pub fn delivery(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["expectedRevision", "enabled"], &[])?;
    let revision = check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?;
    let enabled = check::boolean(&value["enabled"])?;
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        control::change_delivery(
            repo,
            &actor,
            context.parameter("fleetId")?,
            revision,
            enabled,
            &context.request_id,
            now,
        )
    })?;
    reply::of(views::control(&value))
}
pub fn connection(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["stopped"], &[])?;
    let stopped = check::boolean(&value["stopped"])?;
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        control::report_connection(
            repo,
            &actor,
            context.parameter("fleetId")?,
            context.parameter("connectionId")?,
            stopped,
            now,
        )
    })?;
    reply::of(views::control(&value))
}
pub fn integer(value: Option<&str>, minimum: i64, maximum: i64) -> Result<i64> {
    value
        .filter(|value| {
            *value == "0"
                || value
                    .bytes()
                    .next()
                    .is_some_and(|value| (b'1'..=b'9').contains(&value))
                    && value.bytes().all(|value| value.is_ascii_digit())
        })
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value >= minimum && *value <= maximum)
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Use a canonical integer query value"))
}
pub async fn control(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let connection = context.query.identifier("connectionId")?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Invalid,
            "A connectionId, revision and bounded waitMs are required",
        )
    })?;
    let revision = integer(context.query.get("revision"), 0, check::SAFE_INTEGER)?;
    let wait = integer(context.query.get("waitMs"), 0, 10000)?;
    let actor = context.auth.fleet()?;
    let notified = context.state.changed.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    let current = context.with(|repo, now| {
        message::control(repo, &actor, context.parameter("fleetId")?, connection, now)
    })?;
    if current.control.revision != revision
        || !current.messages.is_empty()
        || !current.runtime_operations.is_empty()
        || wait == 0
    {
        return reply::of(wire::snapshot(&current));
    }
    tokio::select! {
        biased;
        _=context.state.stop.cancelled()=>return Err(Failure::new(ErrorCode::Unavailable,"Service is stopping")),
        _=notified=>{},
        _=tokio::time::sleep(Duration::from_millis(wait as u64))=>{},
    }
    let current = context.with(|repo, now| {
        message::control(repo, &actor, context.parameter("fleetId")?, connection, now)
    })?;
    reply::of(wire::snapshot(&current))
}
pub fn messages(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = integer(Some(context.query.get("page").unwrap_or("1")), 1, 100000)?;
    let size = integer(Some(context.query.get("pageSize").unwrap_or("10")), 1, 10)?;
    let actor = context.auth.fleet()?;
    let values = context.with(|repo, now| {
        message::list(repo, &actor, context.parameter("fleetId")?, page, size, now)
    })?;
    reply::page(values, |value| Ok(wire::summary(value)))
}
pub fn create_message(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["messageId", "body"], &[])?;
    let id = check::identifier(&value["messageId"])?;
    let body = check::plain_text(&value["body"], message::MAX_BYTES)?;
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        message::create(
            repo,
            &actor,
            context.parameter("fleetId")?,
            message::Create { id, body },
            &context.request_id,
            now,
        )
    })?;
    reply::of(wire::summary(&value))
}
pub fn acknowledge(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["status", "errorMessage"], &[])?;
    let state = match check::choice(&value["status"], &["delivered", "failed", "skipped"])? {
        "delivered" => message::DeliveryState::Delivered,
        "failed" => message::DeliveryState::Failed,
        _ => message::DeliveryState::Skipped,
    };
    let error_message = if value["errorMessage"].is_null() {
        None
    } else {
        Some(check::text(&value["errorMessage"], 1, 1000)?)
    };
    let actor = context.auth.fleet()?;
    let recorded = context.with(|repo, now| {
        message::acknowledge(
            repo,
            &actor,
            message::Receipt {
                fleet: context.parameter("fleetId")?,
                message: context.parameter("messageId")?,
                agent: context.parameter("agentId")?,
                state,
                error_message,
            },
            now,
        )
    })?;
    reply::of(json!({"recorded":recorded}))
}
pub fn operations(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let actor = context.auth.fleet()?;
    let values = context.with(|repo, now| {
        runtime::list(
            repo,
            &actor,
            context.parameter("fleetId")?,
            page.page,
            page.size,
            now,
        )
    })?;
    reply::page(values, |value| encoded(fleet_runtime::OperationWire(value)))
}
fn encoded<T: serde::Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Fleet response cannot be encoded"))
}
pub fn request(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = fleet_runtime::request(&context.input)?;
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        runtime::request(
            repo,
            &actor,
            context.parameter("fleetId")?,
            &input,
            &context.request_id,
            now,
        )
    })?;
    reply::of(fleet_runtime::OperationWire(&value))
}
pub fn claim(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["connectionId"], &[])?;
    let connection = check::identifier(&value["connectionId"])?;
    let actor = context.auth.fleet()?;
    let value = context.with(|repo, now| {
        runtime::claim(
            repo,
            &actor,
            context.parameter("fleetId")?,
            context.parameter("operationId")?,
            connection,
            now,
        )
    })?;
    reply::of(fleet_runtime::OperationWire(&value))
}
pub fn receipt(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = fleet_runtime::receipt(&context.input)?;
    let actor = context.auth.fleet()?;
    let recorded = context.with(|repo, now| {
        runtime::receipt(
            repo,
            &actor,
            context.parameter("fleetId")?,
            context.parameter("operationId")?,
            &input,
            now,
        )
    })?;
    reply::of(json!({"recorded":recorded}))
}
pub fn native_stop(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["connectionId", "runId", "receiptId"], &[])?;
    let input = native_stop::StopInput {
        fleet: context.parameter("fleetId")?,
        agent: context.parameter("agentId")?,
        connection: check::identifier(&value["connectionId"])?,
        run: check::identifier(&value["runId"])?,
        receipt: check::identifier(&value["receiptId"])?,
    };
    let actor = context.auth.fleet()?;
    context.with(|repo, now| native_stop::record(repo, &actor, input, now))?;
    reply::of(json!({"recorded":true}))
}
pub fn remove(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["expectedRevision", "instanceKey"], &[])?;
    let actor = context.auth.fleet()?;
    let input = retire::Remove {
        fleet: context.parameter("fleetId")?,
        agent: context.parameter("agentId")?,
        instance: check::name(&value["instanceKey"])?,
        expected_revision: check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        request_id: &context.request_id,
    };
    context.with(|repo, now| retire::remove(repo, &actor, input, now))?;
    reply::of(json!({"accepted":true}))
}
pub fn archive(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["expectedRevision"], &[])?;
    let revision = check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?;
    let actor = context.auth.fleet()?;
    context.with(|repo, now| {
        retire::archive(
            repo,
            &actor,
            context.parameter("fleetId")?,
            revision,
            &context.request_id,
            now,
        )
    })?;
    reply::of(json!({"accepted":true}))
}
