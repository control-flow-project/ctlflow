use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::{identity::PrincipalView, identity_input, validation as check, views};
use crossfire_domain::{
    agent,
    authorization::{AgentAction, authorize_agent},
    identity::PrincipalKind,
    member::{self, invitation},
    policy,
    port::{AgentRepository, CoreRepository, DiscoveryRepository},
    read::{self, values::*},
    session,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use serde_json::json;

pub async fn authenticate_backend(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let fields = check::object(&context.input, &["username", "password"], &[])?;
    let username = check::text(&fields["username"], 1, 255)?;
    let password = Secret::new(check::text(&fields["password"], 1, 1024)?.to_owned());
    let token = context
        .state
        .messaging
        .authenticate(username, &password)
        .await?;
    reply::of(json!({"accessToken":token.expose()}))
}

pub async fn create_session(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["nativeAccessToken"], &[])?;
    let token = Secret::new(check::text(&value["nativeAccessToken"], 1, 8192)?.to_owned());
    let opened = session::create(
        &context.state.repository,
        context.state.messaging.as_ref(),
        &token,
        identity::now,
    )
    .await?;
    let mut reply = reply::of(
        json!({"member":views::member(&opened.member), "csrfSecret":opened.csrf_secret.expose(), "permissions":opened.permissions.iter().map(|permission|permission.code()).collect::<Vec<_>>()}),
    )?;
    reply
        .cookies
        .push(crossfire_adapter_http::security::session_cookie(
            Some(&opened.secret),
            crossfire_adapter_http::security::SESSION_COOKIE,
            28800,
        )?);
    Ok(reply)
}
pub fn current_session(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let session = context
        .auth
        .session
        .as_ref()
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, "Management session required"))?;
    reply::of(
        json!({"member":views::member(&session.member),"csrfSecret":session.csrf_secret.expose(),"permissions":session.permissions.iter().map(|permission|permission.code()).collect::<Vec<_>>()}),
    )
}
pub fn end_session(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    context.empty()?;
    let token = context
        .auth
        .cookie
        .as_ref()
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, "Management session required"))?;
    context.with(|repo, _| session::end(repo, token))?;
    let mut reply = reply::of(json!({"accepted":true}))?;
    reply
        .cookies
        .push(crossfire_adapter_http::security::session_cookie(
            None,
            crossfire_adapter_http::security::SESSION_COOKIE,
            0,
        )?);
    Ok(reply)
}
pub fn principals(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let kind = match context.query.get("kind").unwrap_or("all") {
        "all" => None,
        "human" => Some(PrincipalKind::Human),
        "agent" => Some(PrincipalKind::Agent),
        _ => return Err(Failure::new(ErrorCode::Invalid, "Invalid principal kind")),
    };
    let filter = DiscoveryFilter {
        pagination: context.query.page()?,
        kind,
        search: context.query.search()?,
        exclude_id: context.query.identifier("excludeId")?,
    };
    let values = context
        .with(|repo, now| read::discovery::principals(repo, context.actor()?, &filter, now))?;
    reply::page(values, |value| {
        serde_json::to_value(PrincipalView(value))
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Identity cannot be encoded"))
    })
}
pub fn resolve(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = check::object(&context.input, &["backendUserIds"], &[])?;
    let ids = check::list(&value["backendUserIds"], 1, 100)?
        .iter()
        .map(|value| check::backend_user_id(value).map(str::to_owned))
        .collect::<Result<Vec<_>>>()?;
    let values =
        context.with(|repo, now| read::discovery::resolve(repo, context.actor()?, &ids, now))?;
    reply::of(values.iter().map(views::identity).collect::<Vec<_>>())
}
pub fn roles(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let values = context.with(|repo, now| read::discovery::roles(repo, context.actor()?, now))?;
    reply::of(values.iter().map(views::role).collect::<Vec<_>>())
}
pub fn permissions(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let values =
        context.with(|repo, now| read::discovery::permissions(repo, context.actor()?, now))?;
    reply::of(values.iter().map(views::permission).collect::<Vec<_>>())
}
pub fn members(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let values = context
        .with(|repo, now| member::list(repo, context.actor()?, page.page, page.size, now))?;
    reply::page(values, |value| Ok(views::member(value)))
}
pub fn member(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| {
        member::read(repo, context.actor()?, context.parameter("memberId")?, now)
    })?;
    reply::of(views::member(&value))
}
pub fn change_member(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
    role: bool,
) -> Result<Reply> {
    let input = identity_input::member(&context.input, role)?;
    let value = context.with(|repo, now| {
        member::change(
            repo,
            context.actor()?,
            context.parameter("memberId")?,
            &input,
            &context.request_id,
            now,
        )
    })?;
    reply::of(views::member(&value))
}
pub fn policy(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| policy::read(repo, context.actor()?, now))?;
    reply::of(views::policy(&value))
}
pub fn change_policy(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = identity_input::policy(&context.input)?;
    context.with(|repo, now| {
        policy::change(repo, context.actor()?, &input, &context.request_id, now)
    })?;
    policy(context)
}
pub fn audits(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let owner = context.query.identifier("ownerId")?;
    let values = context
        .with(|repo, now| read::discovery::audits(repo, context.actor()?, owner, page, now))?;
    reply::page(values, |value| Ok(views::audit(value)))
}
pub fn create_invitation(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let (role, seconds) = crossfire_contracts::member::invitation_creation(&context.input)?;
    let created = context.with(|repo, now| {
        invitation::create(
            repo,
            context.actor()?,
            role,
            seconds,
            &context.request_id,
            now,
        )
    })?;
    reply::of(
        json!({"invitationId":created.invitation_id,"claimSecret":created.claim_secret.expose(),"expiresAt":created.expires_at,
        "signupUrl":format!("{}/manage/join/{}#{}",context.state.configuration.public_origin.as_str().trim_end_matches('/'),created.invitation_id,created.claim_secret.expose())}),
    )
}
pub fn invitations(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let values = context
        .with(|repo, now| invitation::list(repo, context.actor()?, page.page, page.size, now))?;
    reply::page(values, |value| {
        Ok(crossfire_contracts::member::invitation(value))
    })
}
pub fn invitation(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| {
        invitation::read(
            repo,
            context.actor()?,
            context.parameter("invitationId")?,
            now,
        )
    })?;
    reply::of(crossfire_contracts::member::invitation(&value))
}
pub fn revoke_invitation(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    context.empty()?;
    context.with(|repo, now| {
        invitation::revoke(
            repo,
            context.actor()?,
            context.parameter("invitationId")?,
            &context.request_id,
            now,
        )
    })?;
    reply::of(json!({"accepted":true}))
}
pub fn claim_invitation(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let claim = crossfire_contracts::enrollment::claim(&context.input)?;
    let id = context.parameter("invitationId")?;
    let value = context.with(|repo, now| invitation::verify(repo, id, &claim, now))?;
    let cookie = Secret::new(format!("{id}.{}", claim.expose()));
    let mut reply = reply::of(json!({"accepted":true}))?;
    let seconds =
        u32::try_from((value.expires_at - identity::now()?).max(0) / 1000).map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Invitation clock changed outside its valid lifetime",
            )
        })?;
    reply
        .cookies
        .push(crossfire_adapter_http::security::session_cookie(
            Some(&cookie),
            crossfire_adapter_http::security::INVITATION_COOKIE,
            seconds,
        )?);
    Ok(reply)
}
pub fn registration_policy(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let mode = context
        .with(|repo, _| repo.policy())?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Signup policy is not initialized"))?
        .signup_mode;
    reply::of(json!({"signupMode":mode}))
}
pub fn agents(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let selection = context.query.get("status").unwrap_or("active,suspended");
    let statuses = if selection.is_empty() {
        Vec::new()
    } else {
        selection
            .split(',')
            .map(|value| identity_input::status(&json!(value)))
            .collect::<Result<Vec<_>>>()?
    };
    if statuses
        .iter()
        .enumerate()
        .any(|(index, status)| statuses[..index].contains(status))
    {
        return Err(Failure::new(ErrorCode::Invalid, "Duplicate account status"));
    }
    let listener = match context.query.get("listener").unwrap_or("all") {
        "all" => None,
        "online" => Some(ActivityState::Online),
        "offline" => Some(ActivityState::Offline),
        "disconnecting" => Some(ActivityState::Disconnecting),
        _ => return Err(Failure::new(ErrorCode::Invalid, "Invalid listener filter")),
    };
    let filter = AgentFilter {
        pagination: context.query.page()?,
        owner_id: context.query.identifier("ownerId")?,
        search: context.query.search()?,
        statuses: &statuses,
        listener,
        agent_ids: None,
    };
    let values =
        context.with(|repo, now| read::agent::list(repo, context.actor()?, &filter, now))?;
    reply::page(values, |value| Ok(views::agent(value)))
}
pub fn agent(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| {
        read::agent::read(repo, context.actor()?, context.parameter("agentId")?, now)
    })?;
    reply::of(views::agent(&value))
}
pub fn change_agent(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let (revision, status) = identity_input::agent(&context.input)?;
    context.with(|repo, now| {
        agent::change(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            revision,
            status,
            &context.request_id,
            now,
        )
    })?;
    agent(context)
}
pub fn wake(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| {
        let id = context.parameter("agentId")?;
        let agent = authorize_agent(repo, context.actor()?, id, AgentAction::Read, now)?;
        let principal = repo.agent_view(id)?.ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
        let senders = repo.wake_senders(id)?;
        let identities = repo.selected_principals(&senders.iter().map(|sender| sender.principal_id.clone()).collect::<Vec<_>>())?;
        let selections = senders.iter().map(|sender| {
            let value = identities.iter().find(|value| value.principal_id == sender.principal_id).ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Selected wake identity is missing"))?;
            Ok(json!({"identity":PrincipalView(value),"includeAgents":sender.include_agents}))
        }).collect::<Result<Vec<_>>>()?;
        Ok(json!({"agentId":id,"revision":principal.principal.revision,"mode":views::wake_mode(agent.wake_mode),"senders":selections}))
    })?;
    reply::of(value)
}
pub fn change_wake(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let input = identity_input::wake(&context.input)?;
    context.with(|repo, now| {
        agent::change_wake_policy(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            &input,
            &context.request_id,
            now,
        )
    })?;
    wake(context)
}
pub fn delivery(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let value = context.with(|repo, now| {
        crossfire_domain::room_access::delivery::read(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            now,
        )
    })?;
    reply::of(crossfire_contracts::delivery_policy::value(&value))
}
pub fn history(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let page = context.query.page()?;
    let values = context.with(|repo, now| {
        read::agent::history(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            page,
            now,
        )
    })?;
    reply::page(values, |value| Ok(views::listener(value)))
}
