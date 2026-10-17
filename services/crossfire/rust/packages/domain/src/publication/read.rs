use super::{port::PublicationRepository, values::*};
use crate::{
    authorization::active_actor,
    identity::{Actor, Page, PrincipalKind},
    listener,
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn publisher(repo: &mut impl PublicationRepository, actor: &Actor, now: i64) -> Result<()> {
    if actor.kind != PrincipalKind::Agent {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only enrolled agents publish reports",
        ));
    }
    crate::authorization::authorize(repo, actor, Permission::PublicationPublishSelf, now)?;
    lease(repo, &actor.principal_id, now)
}
fn lease(repo: &mut impl PublicationRepository, id: &str, now: i64) -> Result<()> {
    for run in
        repo.publication_listener_runs(id, now.saturating_sub(listener::HEARTBEAT_EXPIRY_MS))?
    {
        if run.disconnect_requested_at.is_none()
            && listener::controller_admission(
                repo,
                id,
                run.controller.as_ref(),
                now,
                listener::ControllerPurpose::Reporting,
            )?
        {
            return Ok(());
        }
    }
    Err(Failure::new(
        ErrorCode::Forbidden,
        "Publication requires the current authenticated fleet controller listener",
    ))
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Read,
    Publish,
    Delete,
}
pub fn authority(
    repo: &mut impl PublicationRepository,
    actor: &Actor,
    id: &str,
    action: Action,
    now: i64,
) -> Result<Record> {
    active_actor(repo, actor, now)?;
    if actor.kind == PrincipalKind::Agent {
        lease(repo, &actor.principal_id, now)?;
    }
    let record = repo
        .publication(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Report not found"))?;
    let permissions = repo.permissions(&actor.principal_id)?;
    let allowed = if actor.kind == PrincipalKind::Agent {
        action != Action::Delete
            && actor.principal_id == record.publication.agent_id
            && permissions.contains(&Permission::PublicationPublishSelf)
    } else {
        let (any, owned) = match action {
            Action::Read => (
                Permission::PublicationReadAny,
                Permission::PublicationReadOwned,
            ),
            Action::Delete => (
                Permission::PublicationDeleteAny,
                Permission::PublicationDeleteOwned,
            ),
            Action::Publish => return Err(Failure::new(ErrorCode::Missing, "Report not found")),
        };
        permissions.contains(&any)
            || record.owner_id == actor.principal_id && permissions.contains(&owned)
    };
    if allowed {
        Ok(record)
    } else {
        Err(Failure::new(ErrorCode::Missing, "Report not found"))
    }
}
pub fn summary(origin: &str, actor: &Actor, permissions: &[Permission], record: Record) -> Summary {
    let can_delete = actor.kind == PrincipalKind::Human
        && (permissions.contains(&Permission::PublicationDeleteAny)
            || record.owner_id == actor.principal_id
                && permissions.contains(&Permission::PublicationDeleteOwned));
    let value = record.publication;
    Summary {
        url: (value.state == State::Published)
            .then(|| format!("{origin}/{}/index.html", value.public_key)),
        allowed_actions: if can_delete && value.state != State::Deleted {
            vec!["delete"]
        } else {
            vec![]
        },
        id: value.id,
        agent_id: value.agent_id,
        title: value.title,
        state: value.state,
        revision: value.revision,
        created_at: value.created_at,
        expires_at: value.expires_at,
        published_at: value.published_at,
        deleted_at: value.deleted_at,
        total_bytes: value.total_bytes,
        file_count: value.file_count,
        agent_name: record.agent_name,
        owner_id: record.owner_id,
        owner_name: record.owner_name,
    }
}
pub fn details(
    repo: &mut impl PublicationRepository,
    origin: &str,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<Details> {
    let record = authority(repo, actor, id, Action::Read, now)?;
    let permissions = repo.permissions(&actor.principal_id)?;
    Ok(Details {
        files: repo.publication_files(id)?,
        summary: summary(origin, actor, &permissions, record),
    })
}
pub fn page(
    repo: &mut impl PublicationRepository,
    origin: &str,
    actor: &Actor,
    input: &Query,
    now: i64,
) -> Result<Page<Summary>> {
    active_actor(repo, actor, now)?;
    let permissions = repo.permissions(&actor.principal_id)?;
    let any = permissions.contains(&Permission::PublicationReadAny);
    if actor.kind != PrincipalKind::Human
        || !any
            && (!permissions.contains(&Permission::PublicationReadOwned)
                || input
                    .owner_id
                    .as_ref()
                    .is_some_and(|owner| owner != &actor.principal_id))
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Report owner scope is not permitted",
        ));
    }
    let mut input = input.clone();
    if !any {
        input.owner_id = Some(actor.principal_id.clone());
    }
    let page = repo.publications_page(&input)?;
    Ok(Page {
        items: page
            .items
            .into_iter()
            .map(|record| summary(origin, actor, &permissions, record))
            .collect(),
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
