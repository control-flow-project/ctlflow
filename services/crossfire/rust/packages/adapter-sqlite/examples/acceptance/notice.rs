use super::{Checks, SystemClock};
use crossfire_adapter_http::{NativeHttp, segment};
use crossfire_adapter_matrix::account::Authority;
use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_domain::{
    identity::Actor,
    notice::{self, NoticeRepository},
    port::RepositoryAccess,
};
use reqwest::Method;
use serde_json::{Value, json};
pub(super) struct Context<'a> {
    pub repository: &'a SharedStore,
    pub matrix: &'a Authority,
    pub http: &'a NativeHttp,
    pub clock: &'a SystemClock,
    pub actor: &'a Actor,
    pub group: &'a str,
    pub user: &'a str,
    pub owner: &'a str,
    pub outsider: &'a str,
}
pub(super) async fn run(
    context: Context<'_>,
    checks: &mut Checks,
) -> Result<(), Box<dyn std::error::Error>> {
    let Context {
        repository,
        matrix,
        http,
        clock,
        actor,
        group,
        user,
        owner,
        outsider,
    } = context;
    matrix.invite(owner, group, outsider).await?;
    let token = matrix.as_user(outsider).await?;
    http.ok(
        Some(&token),
        Method::POST,
        &format!("/_matrix/client/v3/join/{}", segment(group)),
        Some(&json!({})),
    )
    .await?;
    let mut content = json!({"msgtype":"m.text","body":"Quoted native-specialist is not an interruption or control"});
    for (key, expected) in [
        ("quoted", "not-applicable"),
        ("directed", "pending"),
        ("repeated", "rate-limited"),
    ] {
        if key != "quoted" {
            content["m.mentions"] = json!({"user_ids":[user]});
        }
        let value = http
            .ok(
                Some(&token),
                Method::PUT,
                &format!(
                    "/_matrix/client/v3/rooms/{}/send/m.room.message/{key}",
                    segment(group)
                ),
                Some(&content),
            )
            .await?;
        let event = value
            .get("event_id")
            .and_then(Value::as_str)
            .ok_or("Native source event")?;
        let outcome = notice::request(
            repository,
            matrix,
            clock,
            notice::Input {
                actor,
                receiver: &actor.principal_id,
                room: group,
                event,
            },
        )
        .await?;
        checks.require(
            outcome == expected,
            "native mention eligibility and cooldown use actual event metadata",
        )?;
        if key == "directed" {
            notice::publish(repository, matrix, clock, &actor.principal_id, event).await?;
            let sent = repository
                .with(|repo| repo.wake_notice(&actor.principal_id, event))?
                .ok_or("Sent notice")?;
            checks.require(
                sent.state == notice::State::Sent,
                "unauthorized wake mention receives a native room notice",
            )?;
            let id = sent
                .native_event_id
                .as_deref()
                .ok_or("Native notice event")?;
            let message = matrix.event(user, group, id).await?;
            checks.require(
                message.control && message.message_type.as_deref() == Some("m.notice"),
                "notice is marked as control output and never becomes an agent input",
            )?;
            checks.require(
                message.mentions == vec![outsider.to_owned()],
                "notice directs metadata to the source person",
            )?;
            notice::publish(repository, matrix, clock, &actor.principal_id, event).await?;
            checks.require(
                repository
                    .with(|repo| repo.wake_notice(&actor.principal_id, event))?
                    .ok_or("Repeat notice")?
                    .native_event_id
                    .as_deref()
                    == Some(id),
                "retry cannot duplicate settled notices",
            )?;
        }
    }
    Ok(())
}
