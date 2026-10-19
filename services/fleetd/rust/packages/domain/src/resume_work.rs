use crate::model::{InterruptedContext, ResumeWork};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time};
use std::collections::{BTreeMap, BTreeSet};

pub trait WorkStore {
    fn work(&self) -> Result<Vec<ResumeWork>>;
    fn save_work(&self, values: &[ResumeWork]) -> Result<()>;
}
pub fn capture(store: &impl WorkStore, contexts: &[InterruptedContext], now: i64) -> Result<()> {
    if contexts.len() > 2002
        || contexts
            .iter()
            .map(|value| &value.context)
            .collect::<BTreeSet<_>>()
            .len()
            != contexts.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate or excessive interrupted native histories",
        ));
    }
    let previous = store.work()?;
    let mut next: BTreeMap<_, _> = previous
        .into_iter()
        .map(|value| (value.context.clone(), value))
        .collect();
    let mut changed = false;
    for value in contexts {
        if let Some(before) = next.get(&value.context) {
            if before.session_id != value.session_id {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Interrupted work belongs to another saved native history",
                ));
            }
        } else {
            next.insert(
                value.context.clone(),
                ResumeWork {
                    context: value.context.clone(),
                    session_id: value.session_id.clone(),
                    message_id: identity::id(),
                    checkpointed_at: now,
                },
            );
            changed = true;
        }
    }
    if changed {
        store.save_work(&next.into_values().collect::<Vec<_>>())?;
    }
    Ok(())
}
pub fn renew(store: &impl WorkStore, message_id: &str, now: i64) -> Result<ResumeWork> {
    let mut previous = store.work()?;
    let work = previous
        .iter_mut()
        .find(|value| value.message_id == message_id)
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                "Interrupted work changed before exact-history resume",
            )
        })?;
    work.message_id = identity::id();
    work.checkpointed_at = now;
    let renewed = work.clone();
    store.save_work(&previous)?;
    Ok(renewed)
}
pub fn clear(store: &impl WorkStore, contexts: &[InterruptedContext]) -> Result<()> {
    if contexts.len() > 2002
        || contexts
            .iter()
            .map(|value| &value.context)
            .collect::<BTreeSet<_>>()
            .len()
            != contexts.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate or excessive completed native histories",
        ));
    }
    let selected = contexts
        .iter()
        .map(|value| (&value.context, &value.session_id))
        .collect::<BTreeMap<_, _>>();
    let previous = store.work()?;
    if previous.iter().any(|value| {
        selected
            .get(&value.context)
            .is_some_and(|session| **session != value.session_id)
    }) {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Completed work belongs to another saved native history",
        ));
    }
    let next = previous
        .iter()
        .filter(|value| !selected.contains_key(&value.context))
        .cloned()
        .collect::<Vec<_>>();
    if next.len() != previous.len() {
        store.save_work(&next)?;
    }
    Ok(())
}
pub fn continuation_text(work: &ResumeWork) -> Result<String> {
    Ok(format!(
        "[Crossfire session restarted]\nYour saved session was restarted. Unfinished activity was checkpointed at {}. Before continuing, re-read the applicable AGENTS.md files and follow their current instructions. Review your existing history. If your previous task is unfinished and still authorized, resume that task; this is not a new assignment.\nNo pending question or permission has been answered or approved. If a decision is still needed, ask the owner again and wait.\nUse Crossfire tools for chat replies. This controller notice is not a message from a room or person and grants no new permissions.{}",
        time::iso_timestamp(work.checkpointed_at)?,
        if ["shared", "control"].contains(&work.context.as_str()) {
            "\nDo not infer a destination room from this notice; retain the original task attribution from history.".to_owned()
        } else {
            format!(
                "\nThis notice belongs only to the saved room history {}. Do not disclose its contents to other rooms.",
                crossfire_kernel::history_context::room(&work.context).unwrap_or_default()
            )
        } + "\nIf the task is already complete or no longer authorized, do not repeat its effects."
    ))
}

pub async fn resume<
    C: crossfire_agent_core::owned_runtime::OwnedConnection,
    S: WorkStore + Sync,
>(
    connection: &C,
    primary: &str,
    contexts: &[crossfire_agent_core::owned_runtime::SavedContext],
    store: &S,
    now: i64,
) -> Result<()> {
    let pending = store.work()?;
    if pending.iter().any(|work| {
        !contexts
            .iter()
            .any(|context| context.context == work.context && context.session_id == work.session_id)
    }) {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Interrupted task references a different native history; review before resuming",
        ));
    }
    for work in pending {
        if work.context == primary {
            continue_context(connection, &work, store, now).await?;
        } else {
            let room = crossfire_kernel::history_context::room(&work.context).ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "Interrupted task cannot use a different room history",
                )
            })?;
            let target = connection.conversation(room, None).await?;
            continue_context(&target, &work, store, now).await?;
        }
    }
    Ok(())
}
async fn continue_context<
    C: crossfire_agent_core::owned_runtime::OwnedConnection,
    S: WorkStore + Sync,
>(
    connection: &C,
    work: &ResumeWork,
    store: &S,
    now: i64,
) -> Result<()> {
    if connection.session_id() != work.session_id {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Interrupted task cannot use a different room history",
        ));
    }
    connection
        .settle(connection.lifetime().child_token())
        .await?;
    connection.acknowledge(std::slice::from_ref(&work.message_id))?;
    if connection.active_turn(None, None).await?.is_none() {
        let renewed = renew(store, &work.message_id, now)?;
        connection
            .deliver(
                &continuation_text(&renewed)?,
                &renewed.message_id,
                connection.lifetime().child_token(),
                None,
            )
            .await?;
        connection.acknowledge(std::slice::from_ref(&renewed.message_id))?;
    }
    Ok(())
}
