use crate::state::State;
use crossfire_contracts::identity::IntentHash;
use crossfire_domain::{
    enrollment,
    logging::{MAINTENANCE_MS, Retention},
    member::signup,
    notice::{self, NoticeRepository},
    port::{RepositoryAccess, UnitOfWork},
    principal::{self, PrincipalRepository},
    room_access::{self, port::RoomReadRepository},
    runtime::{decisions, incidents},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::iso_timestamp};
use futures_util::{StreamExt, stream};
use std::{sync::Arc, time::Duration};

fn record(
    state: &State<impl crossfire_domain::messaging::MessagingAuthority>,
    label: &str,
    error: &Failure,
) -> Result<()> {
    state.diagnostics.write(
        identity::now()?,
        &format!(
            "{label}: {}; native state remains unverified",
            error.code.as_str()
        ),
    )
}
async fn reconcile(
    state: &State<impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<()> {
    state.repository.with(|repo| {
        let now = identity::now()?;
        repo.transaction(|repo| enrollment::expire::expire(repo, now))?;
        decisions::expire(repo, now)?;
        incidents::watch(
            repo,
            &incidents::NoticeContext {
                public_origin: state
                    .configuration
                    .public_origin
                    .as_str()
                    .trim_end_matches('/'),
                observed_iso: &iso_timestamp(now)?,
            },
            now,
        )
    })?;
    signup::reclaim(&state.repository, state.messaging.as_ref(), &identity::now).await?;
    let principals = state
        .repository
        .with(|repo| repo.due_principals(identity::now()?))?;
    let mut applying = stream::iter(principals.into_iter().map(|id| async move {
        principal::reconcile(
            &state.repository,
            state.messaging.as_ref(),
            &state.room_operations,
            &identity::now,
            &IntentHash,
            &id,
        )
        .await
    }))
    .buffer_unordered(4);
    while let Some(result) = applying.next().await {
        if let Err(error) = result {
            record(state, "Principal reconciliation remains pending", &error)?;
        }
        if state.stop.is_cancelled() {
            return Ok(());
        }
    }
    let rooms = state
        .repository
        .with(|repo| repo.due_room_grants(identity::now()?))?;
    let mut applying = stream::iter(rooms.into_iter().map(|(agent, room)| async move {
        room_access::reconcile::reconcile(
            &state.repository,
            state.messaging.as_ref(),
            &state.room_operations,
            &identity::now,
            &agent,
            &room,
        )
        .await
    }))
    .buffer_unordered(4);
    while let Some(result) = applying.next().await {
        if let Err(error) = result {
            record(state, "Room reconciliation remains pending", &error)?;
        }
        if state.stop.is_cancelled() {
            return Ok(());
        }
    }
    let notices = state
        .repository
        .with(|repo| repo.due_wake_notices(identity::now()?))?;
    for pending in notices {
        if state.stop.is_cancelled() {
            return Ok(());
        }
        if let Err(error) = notice::publish(
            &state.repository,
            state.messaging.as_ref(),
            &identity::now,
            &pending.receiver_agent_id,
            &pending.room_id,
            &pending.event_id,
        )
        .await
        {
            record(state, "Wake notice remains pending", &error)?;
        }
    }
    incidents::publish(
        &state.repository,
        state.messaging.as_ref(),
        state.messaging.service_user_id(),
        &identity::now,
        || state.stop.is_cancelled(),
    )
    .await?;
    state.publications().maintain()?;
    Ok(())
}
async fn applications(
    state: Arc<State<impl crossfire_domain::messaging::MessagingAuthority>>,
) -> Result<()> {
    let mut timer = tokio::time::interval(Duration::from_secs(5));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! { biased;
            _ = state.stop.cancelled() => return Ok(()),
            _ = state.changed.notified() => {},
            _ = timer.tick() => {},
        }
        if let Err(error) = reconcile(&state).await {
            if state.stop.is_cancelled() {
                return Ok(());
            }
            record(&state, "Crossfire reconciliation remains pending", &error)?;
        }
    }
}
async fn maintenance(
    state: Arc<State<impl crossfire_domain::messaging::MessagingAuthority>>,
) -> Result<()> {
    let mut retention = Retention::new(Some(state.configuration.logging_retention_days))?;
    let mut next = tokio::time::Instant::now();
    loop {
        tokio::select! { biased; _ = state.stop.cancelled() => return Ok(()), _ = tokio::time::sleep_until(next) => {} }
        let outcome = state
            .repository
            .with(|repo| retention.maintain(repo, identity::now()?, 1000));
        let (delay, error) = match outcome {
            Ok((_, more)) => (if more { 5000 } else { MAINTENANCE_MS }, None),
            Err(error) => {
                record(
                    &state,
                    "Platform logging maintenance remains pending",
                    &error,
                )?;
                (5000, Some("Platform logging maintenance remains pending"))
            }
        };
        state.diagnostics.maintenance_error(error)?;
        let source = Arc::clone(&state);
        let cleaned =
            tokio::task::spawn_blocking(move || source.diagnostics.maintain(identity::now()?))
                .await
                .map_err(|_| {
                    Failure::new(
                        ErrorCode::Unavailable,
                        "Diagnostic cleanup ownership failed",
                    )
                })?;
        if cleaned.is_err() {
            record(
                &state,
                "Platform diagnostic cleanup remains pending",
                &Failure::new(ErrorCode::Unavailable, "Diagnostic cleanup remains pending"),
            )?;
        }
        next = tokio::time::Instant::now() + Duration::from_millis(delay as u64);
    }
}
pub async fn run(
    state: Arc<State<impl crossfire_domain::messaging::MessagingAuthority>>,
) -> Result<()> {
    tokio::try_join!(applications(Arc::clone(&state)), maintenance(state))?;
    Ok(())
}
