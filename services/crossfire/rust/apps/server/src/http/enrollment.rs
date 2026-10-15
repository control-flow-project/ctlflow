use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::enrollment as wire;
use crossfire_domain::enrollment;
use crossfire_kernel::{Result, identity};
use serde_json::json;
pub async fn preflight(context: &Context<'_>) -> Result<Reply> {
    let roster = wire::roster(&context.input)?;
    enrollment::preflight::preflight(&context.state.repository, &context.state.matrix, &roster)
        .await?;
    reply::of(json!({"available":true,"instances":roster.instances.len()}))
}
pub async fn introduce(context: &Context<'_>) -> Result<Reply> {
    let input = wire::introduction(&context.input)?;
    let value = enrollment::introduce::introduce(
        &context.state.repository,
        &context.state.matrix,
        &context.state.digest,
        &input,
        identity::now()?,
    )
    .await?;
    reply::of(
        json!({"enrollment":wire::details(&value,&context.state.digest)?,"approvalUrl":format!("{}/manage/enrollments/{}",context.state.configuration.public_origin.as_str().trim_end_matches('/'),value.request.id)}),
    )
}
pub fn list(context: &Context<'_>) -> Result<Reply> {
    let page = context.query.page()?;
    let owner = context.query.identifier("ownerId")?;
    let values = context.with(|repo, now| {
        enrollment::read::page(repo, context.actor()?, owner, page.page, page.size, now)
    })?;
    reply::page(values, |(request, owner)| wire::overview(request, owner))
}
pub fn read(context: &Context<'_>) -> Result<Reply> {
    let value = context.with(|repo, now| {
        enrollment::read::read(
            repo,
            context.actor()?,
            context.parameter("enrollmentId")?,
            now,
        )
    })?;
    reply::of(wire::details(&value, &context.state.digest)?)
}
pub fn decide(context: &Context<'_>) -> Result<Reply> {
    let input = wire::decision(&context.input)?;
    let value = context.with(|repo, now| {
        enrollment::decide::decide(
            repo,
            context.actor()?,
            context.parameter("enrollmentId")?,
            &input,
            &context.request_id,
            &context.state.configuration.server_name,
            now,
        )
    })?;
    reply::of(wire::decided(&value))
}
pub fn exchange(context: &Context<'_>) -> Result<Reply> {
    let claim = wire::claim(&context.input)?;
    let value = context.with(|repo, now| {
        enrollment::exchange::exchange(repo, context.parameter("enrollmentId")?, &claim, now)
    })?;
    reply::of(wire::exchanged(&value))
}
