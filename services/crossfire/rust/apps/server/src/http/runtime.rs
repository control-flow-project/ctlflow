use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::{runtime as wire, validation as check};
use crossfire_domain::{
    listener,
    runtime::{decisions, incidents::NoticeContext, observations, values::DecisionStatus},
};
use crossfire_kernel::{Result, identity, secret::Secret, time::iso_timestamp};
use serde_json::json;
pub fn observations(context: &Context<'_>) -> Result<Reply> {
    let values = context.with(|repo, now| {
        observations::read(repo, context.actor()?, context.parameter("agentId")?, now)
    })?;
    reply::of(values.iter().map(wire::ObservationWire).collect::<Vec<_>>())
}
pub fn report(context: &Context<'_>) -> Result<Reply> {
    let input = wire::observation(&context.input)?;
    context.with(|repo, now| {
        observations::report(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("runId")?,
            &input,
            &NoticeContext {
                public_origin: context
                    .state
                    .configuration
                    .public_origin
                    .as_str()
                    .trim_end_matches('/'),
                observed_iso: &iso_timestamp(now)?,
            },
            now,
        )
    })?;
    reply::of(json!({"accepted":true}))
}
pub fn decisions(context: &Context<'_>) -> Result<Reply> {
    let page = context.query.page()?;
    let status = context
        .query
        .get("status")
        .map(|value| {
            check::choice(&json!(value), &["pending"])?;
            Ok(DecisionStatus::Pending)
        })
        .transpose()?;
    let values = context.with(|repo, now| {
        decisions::list(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            page.page,
            page.size,
            status,
            now,
        )
    })?;
    reply::page(values, |value| {
        serde_json::to_value(wire::SummaryWire(value)).map_err(|_| {
            crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Unavailable,
                "Native decision cannot be encoded",
            )
        })
    })
}
pub fn create_decision(context: &Context<'_>) -> Result<Reply> {
    let input = wire::decision(&context.input)?;
    let value = context.with(|repo, now| {
        decisions::create(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            &input,
            now,
        )
    })?;
    reply::of(wire::DecisionWire(&value))
}
pub fn decision(context: &Context<'_>) -> Result<Reply> {
    let value = context.with(|repo, now| {
        decisions::read(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("decisionId")?,
            now,
        )
    })?;
    reply::of(wire::DecisionWire(&value))
}
pub fn answer(context: &Context<'_>) -> Result<Reply> {
    let answers = wire::answers(&context.input)?;
    context.with(|repo, now| {
        decisions::answer(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("decisionId")?,
            &answers,
            &context.request_id,
            now,
        )
    })?;
    reply::of(json!({"accepted":true}))
}
pub fn poll(context: &Context<'_>) -> Result<Reply> {
    let (status, answers) = context.with(|repo, now| {
        decisions::poll(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("decisionId")?,
            now,
        )
    })?;
    reply::of(json!({"status":status.code(),"answers":wire::AnswersWire(&answers)}))
}
pub fn receipt(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(&context.input, &["status"], &[])?;
    let status = DecisionStatus::parse(check::choice(
        &value["status"],
        &["responded", "cancelled"],
    )?)?;
    let recorded = context.with(|repo, now| {
        decisions::receipt(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            context.parameter("decisionId")?,
            status,
            now,
        )
    })?;
    reply::of(json!({"recorded":recorded}))
}
pub fn listener_report(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(
        &context.input,
        &[
            "release",
            "messagesDelivered",
            "stopped",
            "controller",
            "statistics",
        ],
        &[],
    )?;
    let controller = check::object(
        &value["controller"],
        &["fleetId", "connectionId", "credential"],
        &[],
    )?;
    let input = listener::Report {
        run_id: context.parameter("runId")?.to_owned(),
        release: check::text(&value["release"], 1, 200)?.to_owned(),
        messages_delivered: check::integer(&value["messagesDelivered"], 0, check::SAFE_INTEGER)?,
        stopped: check::boolean(&value["stopped"])?,
        controller: listener::Proof {
            fleet_id: check::identifier(&controller["fleetId"])?.to_owned(),
            connection_id: check::identifier(&controller["connectionId"])?.to_owned(),
            credential: Secret::new(check::text(&controller["credential"], 1, 200)?.to_owned()),
        },
        statistics: if value["statistics"].is_null() {
            None
        } else {
            Some(crossfire_contracts::statistics::batch(
                &value["statistics"],
            )?)
        },
    };
    let value = context.with(|repo, now| {
        listener::report(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            &input,
            &context.state.release.manifest.release,
            now,
        )
    })?;
    reply::of(
        json!({"disconnect":value.disconnect,"currentRelease":value.current_release,"statisticsAccepted":value.statistics_accepted}),
    )
}
pub async fn notice(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(&context.input, &["roomId"], &[])?;
    let room = check::room_id(&value["roomId"])?;
    let value = crossfire_domain::notice::request(
        &context.state.repository,
        &context.state.matrix,
        &identity::now,
        crossfire_domain::notice::Input {
            actor: context.actor()?,
            receiver: context.parameter("agentId")?,
            room: &room,
            event: context.parameter("eventId")?,
        },
    )
    .await?;
    reply::of(json!({"outcome":value}))
}

pub fn failure(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(
        &context.input,
        &["episodeId", "agentId", "sessionId", "message"],
        &[],
    )?;
    let episode_id = check::identifier(&value["episodeId"])?;
    let agent_id = check::identifier(&value["agentId"])?;
    let session_id = if value["sessionId"].is_null() {
        None
    } else {
        Some(check::text(&value["sessionId"], 1, 255)?)
    };
    let message = check::plain_text(&value["message"], 4000)?;
    let actor = context.auth.fleet()?;
    context.with(|repo, now| {
        crossfire_domain::runtime::incidents::report(
            repo,
            &actor,
            context.parameter("fleetId")?,
            crossfire_domain::runtime::incidents::FailureReport {
                episode_id,
                agent_id,
                session_id,
                message,
            },
            &NoticeContext {
                public_origin: context
                    .state
                    .configuration
                    .public_origin
                    .as_str()
                    .trim_end_matches('/'),
                observed_iso: &iso_timestamp(now)?,
            },
            now,
        )
    })?;
    reply::of(json!({"accepted":true}))
}
