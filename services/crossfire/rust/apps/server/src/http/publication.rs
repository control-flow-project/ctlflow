use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::publication as wire;
use crossfire_domain::publication::{read, values::Query};
use crossfire_kernel::Result;
use serde_json::json;
pub fn create(context: &Context<'_>) -> Result<Reply> {
    let input = wire::creation(&context.input)?;
    let value =
        context
            .state
            .publications()
            .create(context.actor()?, &input, &context.request_id)?;
    reply::of(wire::details(&value))
}
pub fn list(context: &Context<'_>) -> Result<Reply> {
    let page = context.query.page()?;
    let query = Query {
        page: page.page,
        page_size: page.size,
        search: context.query.search()?.to_owned(),
        owner_id: context.query.identifier("ownerId")?.map(str::to_owned),
        agent_id: context.query.identifier("agentId")?.map(str::to_owned),
        state: context
            .query
            .get("state")
            .map(|value| wire::state(&json!(value)))
            .transpose()?,
    };
    let values = context.with(|repo, now| {
        read::page(
            repo,
            context
                .state
                .configuration
                .content_origin
                .as_str()
                .trim_end_matches('/'),
            context.actor()?,
            &query,
            now,
        )
    })?;
    reply::page(values, |value| Ok(wire::summary(value)))
}
pub fn read(context: &Context<'_>) -> Result<Reply> {
    let value = context.with(|repo, now| {
        read::details(
            repo,
            context
                .state
                .configuration
                .content_origin
                .as_str()
                .trim_end_matches('/'),
            context.actor()?,
            context.parameter("publicationId")?,
            now,
        )
    })?;
    reply::of(wire::details(&value))
}
pub async fn commit(context: &Context<'_>) -> Result<Reply> {
    let revision = wire::mutation(&context.input)?;
    let value = context
        .state
        .publications()
        .commit(
            context.actor()?,
            context.parameter("publicationId")?,
            revision,
            &context.request_id,
        )
        .await?;
    reply::of(wire::details(&value))
}
pub fn delete(context: &Context<'_>) -> Result<Reply> {
    let revision = wire::mutation(&context.input)?;
    context.state.publications().delete(
        context.actor()?,
        context.parameter("publicationId")?,
        revision,
        &context.request_id,
    )?;
    reply::of(json!({"deleted":true}))
}
