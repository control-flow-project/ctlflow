use super::{
    decisions::live_run,
    incidents::{self, IncidentInput, NoticeContext},
    port::ObservationRepository,
    values::*,
};
use crate::{
    authorization::{AgentAction, authorize, authorize_agent},
    identity::Actor,
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::HashSet;

const SETTINGS: &[&str] = &[
    "model",
    "model_reasoning_effort",
    "sandbox_mode",
    "approval_policy",
    "native_version",
    "dangerously_bypass_approvals_and_sandbox",
    "features.default_mode_request_user_input",
    "provider",
    "thinking_level",
];

pub fn report(
    repo: &mut impl ObservationRepository,
    actor: &Actor,
    agent_id: &str,
    run_id: &str,
    input: &Observation,
    context: &NoticeContext<'_>,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        authorize(repo, actor, Permission::RuntimeReportSelf, now)?;
        if actor.principal_id != agent_id {
            return Err(Failure::new(ErrorCode::Missing, "Agent not found"));
        }
        live_run(repo, agent_id, run_id, now)?;
        let mut names = HashSet::new();
        if input.observed_at > now.saturating_add(60_000)
            || input.settings.iter().any(|setting| {
                !names.insert(&setting.name) || !SETTINGS.contains(&setting.name.as_str())
            })
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Only public runtime settings may be reported",
            ));
        }
        if input
            .last_activity_at
            .is_some_and(|value| value > now.saturating_add(60_000))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Native activity cannot be reported in the future",
            ));
        }
        let previous = repo.observations(agent_id)?;
        let original = previous.iter().find(|value| {
            value.run_id == run_id && value.observation.session_id == input.session_id
        });
        if original.is_some_and(|value| {
            value.observation.room_id != input.room_id
                || value.observation.history_mode != input.history_mode
                || value.observation.runtime != input.runtime
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native history scope or listener configuration changed within the run",
            ));
        }
        if original.is_none() && previous.len() >= 2002 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Too many native histories in this listener run",
            ));
        }
        if original.is_some_and(|value| value.observation.observed_at > input.observed_at) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Runtime observation is older than the recorded state",
            ));
        }
        repo.save_observation(
            agent_id,
            &ObservationView {
                run_id: run_id.to_owned(),
                observation: input.clone(),
            },
        )?;
        if !matches!(input.state, State::Unavailable | State::Sleeping) {
            repo.invalidate_native_stop(agent_id, now)?;
        }
        if input.state == State::Failed {
            let agent = repo
                .agent_view(agent_id)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
            let name = repo
                .agent_name(agent_id)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent name not found"))?;
            let message = format!(
                "{name} ({}) failed: {}",
                agent.owner_member.display_name,
                input.error_message.as_deref().unwrap_or(
                    "Native execution failed. Inspect the original session before resuming."
                )
            );
            incidents::open(
                repo,
                &IncidentInput {
                    owner_id: &agent.agent.owner_id,
                    agent_id: Some(agent_id),
                    fleet_id: None,
                    run_id: Some(run_id),
                    session_id: Some(&input.session_id),
                    kind: IncidentKind::Failure,
                    message: &message,
                },
                None,
                context,
                now,
            )?;
        } else if matches!(
            input.state,
            State::Idle | State::Working | State::WaitingApproval | State::WaitingAnswer
        ) {
            incidents::recover(
                repo,
                Some(agent_id),
                None,
                Some(&input.session_id),
                None,
                now,
            )?;
        }
        Ok(())
    })
}

pub fn read(
    repo: &mut impl ObservationRepository,
    actor: &Actor,
    agent_id: &str,
    now: i64,
) -> Result<Vec<ObservationView>> {
    authorize_agent(repo, actor, agent_id, AgentAction::Read, now)?;
    repo.observations(agent_id)
}
