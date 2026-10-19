use super::{port::EnrollmentRepository, values::*};
use crate::{
    authorization::authorize,
    identity::{Actor, Page, PrincipalKind},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn receipt(repo: &mut impl EnrollmentRepository, request: Request) -> Result<Receipt> {
    let owner = repo
        .selected_principals(std::slice::from_ref(&request.owner_id))?
        .into_iter()
        .find(|owner| owner.principal_id == request.owner_id && owner.kind == PrincipalKind::Human)
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Enrollment owner is unavailable"))?;
    let policies = repo.requested_policies(&request.id)?;
    let mut instances = Vec::new();
    for item in repo.enrollment_items(&request.id)? {
        let requested = policies.get(&item.instance_key).ok_or_else(|| {
            Failure::new(
                ErrorCode::Unavailable,
                "Enrollment coordination policy is missing",
            )
        })?;
        let mut senders = Vec::with_capacity(requested.senders.len());
        for sender in &requested.senders {
            let principal = repo.principal(&sender.principal_id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Selected sender identity is missing",
                )
            })?;
            senders.push(crate::coordination::BackendSender {
                backend_user_id: principal.backend_user_id,
                include_agents: sender.include_agents,
            });
        }
        let current_name = item
            .agent_id
            .as_deref()
            .map(|agent| repo.agent_name(agent))
            .transpose()?
            .flatten();
        instances.push(ItemView {
            item,
            current_name,
            policy: crate::coordination::Policy {
                mode: requested.mode,
                senders,
                invite_agents: requested.invite_agents,
            },
        });
    }
    Ok(Receipt {
        request,
        owner,
        instances,
    })
}
pub fn read(
    repo: &mut impl EnrollmentRepository,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<Receipt> {
    let request = repo
        .enrollment_request(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Enrollment not found"))?;
    authorize(
        repo,
        actor,
        if request.owner_id == actor.principal_id {
            Permission::EnrollmentReadOwned
        } else {
            Permission::EnrollmentReadAny
        },
        now,
    )?;
    receipt(repo, request)
}
pub fn page(
    repo: &mut impl EnrollmentRepository,
    actor: &Actor,
    owner: Option<&str>,
    page: i64,
    size: i64,
    now: i64,
) -> Result<Page<(Request, crate::identity::PrincipalSummary)>> {
    crate::authorization::active_actor(repo, actor, now)?;
    let any = repo
        .permissions(&actor.principal_id)?
        .contains(&Permission::EnrollmentReadAny);
    let scope = if any {
        owner
    } else {
        authorize(repo, actor, Permission::EnrollmentReadOwned, now)?;
        if owner.is_some_and(|owner| owner != actor.principal_id) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Enrollment owner scope is not authorized",
            ));
        }
        Some(actor.principal_id.as_str())
    };
    let values = repo.enrollments_page(scope, page, size)?;
    let owners = repo.selected_principals(
        &values
            .items
            .iter()
            .map(|item| item.owner_id.clone())
            .collect::<Vec<_>>(),
    )?;
    let items = values
        .items
        .into_iter()
        .map(|item| {
            let owner = owners
                .iter()
                .find(|owner| {
                    owner.principal_id == item.owner_id && owner.kind == PrincipalKind::Human
                })
                .cloned()
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Enrollment owner is unavailable")
                })?;
            Ok((item, owner))
        })
        .collect::<Result<_>>()?;
    Ok(Page {
        items,
        page: values.page,
        page_size: values.page_size,
        total_items: values.total_items,
        total_pages: values.total_pages,
    })
}
