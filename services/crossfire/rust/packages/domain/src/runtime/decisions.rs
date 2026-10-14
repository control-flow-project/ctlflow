use super::{port::DecisionRepository, values::*};
use crate::{
    authorization::{AgentAction, authorize, authorize_agent},
    identity::{Actor, PrincipalKind},
    listener::{self, HEARTBEAT_EXPIRY_MS, Run},
    permission::Permission,
    port::Audit,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::HashSet;

pub fn live_run(
    repo: &mut impl crate::port::ListenerRepository,
    agent_id: &str,
    run_id: &str,
    now: i64,
) -> Result<Run> {
    let run = repo
        .listener_run(run_id)?
        .filter(|run| {
            run.agent_id == agent_id
                && run.stopped_at.is_none()
                && run.disconnect_requested_at.is_none()
                && run.last_seen_at.saturating_add(HEARTBEAT_EXPIRY_MS) > now
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                "The original listener is no longer available",
            )
        })?;
    if !listener::controller_admission(repo, agent_id, run.controller.as_ref(), now)? {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "The original controller lease is no longer available",
        ));
    }
    Ok(run)
}

fn current(
    repo: &mut impl DecisionRepository,
    mut value: DecisionSummary,
    now: i64,
) -> Result<DecisionSummary> {
    if !matches!(
        value.status,
        DecisionStatus::Pending | DecisionStatus::Answered
    ) {
        return Ok(value);
    }
    let live = live_run(repo, &value.agent_id, &value.header.run_id, now);
    if let Err(error) = &live
        && error.code != ErrorCode::Conflict
    {
        return Err(error.clone());
    }
    if value
        .header
        .expires_at
        .is_some_and(|expires_at| expires_at <= now)
        || live.is_err()
    {
        value.status = DecisionStatus::Expired;
    }
    Ok(value)
}

pub fn create(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    input: &DecisionRequest,
    now: i64,
) -> Result<Decision> {
    repo.transaction(|repo| {
        authorize(repo, actor, Permission::RuntimeReportSelf, now)?;
        if actor.principal_id != agent_id {
            return Err(Failure::new(ErrorCode::Missing, "Agent not found"));
        }
        live_run(repo, agent_id, &input.header.run_id, now)?;
        if input
            .header
            .expires_at
            .is_some_and(|expires_at| expires_at <= now)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "The native decision has already expired",
            ));
        }
        let mut questions = HashSet::new();
        for question in &input.questions {
            let mut options = HashSet::new();
            if !questions.insert(&question.id)
                || (!question.allow_text && question.options.is_empty())
                || question
                    .options
                    .iter()
                    .any(|option| !options.insert(&option.id))
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Native questions need unique identities and an answer mechanism",
                ));
            }
        }
        if let Some(mut previous) = repo.decision(&input.header.id)? {
            if previous.summary.agent_id != agent_id
                || previous.summary.header != input.header
                || previous.review != input.review
                || previous.questions != input.questions
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Decision identity is already bound to another native request",
                ));
            }
            previous.summary = current(repo, previous.summary, now)?;
            return Ok(previous);
        }
        let value = Decision {
            summary: DecisionSummary {
                header: input.header.clone(),
                agent_id: agent_id.to_owned(),
                status: DecisionStatus::Pending,
                created_at: now,
            },
            review: input.review.clone(),
            questions: input.questions.clone(),
        };
        repo.insert_decision(&value)?;
        Ok(value)
    })
}

pub fn read(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    id: &str,
    now: i64,
) -> Result<Decision> {
    authorize_agent(repo, actor, agent_id, AgentAction::Read, now)?;
    let mut value = repo
        .decision(id)?
        .filter(|value| value.summary.agent_id == agent_id)
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Decision not found"))?;
    value.summary = repo.transaction(|repo| current(repo, value.summary, now))?;
    Ok(value)
}

pub fn list(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    page: i64,
    page_size: i64,
    status: Option<DecisionStatus>,
    now: i64,
) -> Result<crate::identity::Page<DecisionSummary>> {
    authorize_agent(repo, actor, agent_id, AgentAction::Read, now)?;
    expire(repo, now)?;
    let mut values = repo.decisions(agent_id, page, page_size, status)?;
    values.items = repo.transaction(|repo| {
        values
            .items
            .into_iter()
            .map(|value| current(repo, value, now))
            .collect()
    })?;
    Ok(values)
}

pub fn answer(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    id: &str,
    answers: &[Answer],
    request_id: &str,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        authorize(repo, actor, Permission::RuntimeDecisionAnswerOwned, now)?;
        if actor.kind != PrincipalKind::Human
            || repo
                .agent(agent_id)?
                .is_none_or(|agent| agent.owner_id != actor.principal_id)
        {
            return Err(Failure::new(ErrorCode::Missing, "Owner decision not found"));
        }
        let decision = read(repo, actor, agent_id, id, now)?;
        if decision.summary.status != DecisionStatus::Pending {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "This native request is no longer pending",
            ));
        }
        let unique: HashSet<_> = answers.iter().map(|answer| &answer.question_id).collect();
        if answers.len() != decision.questions.len() || unique.len() != decision.questions.len() {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Answer every native question exactly once",
            ));
        }
        for question in &decision.questions {
            let valid = answers
                .iter()
                .find(|answer| answer.question_id == question.id)
                .is_some_and(|answer| match (&answer.option_id, &answer.text) {
                    (Some(option), None) => {
                        question.options.iter().any(|choice| choice.id == *option)
                    }
                    (None, Some(text)) => {
                        question.allow_text
                            && !text
                                .trim_matches(crossfire_kernel::text::whitespace)
                                .is_empty()
                    }
                    _ => false,
                });
            if !valid {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Answer is not one of the native choices",
                ));
            }
        }
        repo.answer(id, answers)?;
        let mut event = Audit::new(
            actor,
            request_id,
            "runtime-decision",
            id,
            "runtime-decision.answer",
            Some(&actor.principal_id),
            now,
        );
        event.message = "Owner submitted a native answer; answer content is private.".to_owned();
        repo.audit(&event)
    })
}

pub fn poll(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    id: &str,
    now: i64,
) -> Result<(DecisionStatus, Vec<Answer>)> {
    authorize(repo, actor, Permission::RuntimeReportSelf, now)?;
    if actor.principal_id != agent_id {
        return Err(Failure::new(ErrorCode::Missing, "Decision not found"));
    }
    let current = read(repo, actor, agent_id, id, now)?;
    let answers = if current.summary.status == DecisionStatus::Answered {
        repo.answers(id)?
    } else {
        Vec::new()
    };
    Ok((current.summary.status, answers))
}

pub fn receipt(
    repo: &mut impl DecisionRepository,
    actor: &Actor,
    agent_id: &str,
    id: &str,
    status: DecisionStatus,
    now: i64,
) -> Result<bool> {
    if !matches!(
        status,
        DecisionStatus::Responded | DecisionStatus::Cancelled
    ) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native decision receipt",
        ));
    }
    repo.transaction(|repo| {
        authorize(repo, actor, Permission::RuntimeReportSelf, now)?;
        if actor.principal_id != agent_id {
            return Err(Failure::new(ErrorCode::Missing, "Decision not found"));
        }
        let Some(decision) = repo.decision(id)? else {
            return Ok(false);
        };
        if decision.summary.agent_id != agent_id {
            return Err(Failure::new(ErrorCode::Missing, "Decision not found"));
        }
        if status == DecisionStatus::Responded
            && !matches!(
                decision.summary.status,
                DecisionStatus::Answered | DecisionStatus::Responded
            )
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "No answer was submitted to this native request",
            ));
        }
        if status == DecisionStatus::Cancelled
            && !matches!(
                decision.summary.status,
                DecisionStatus::Pending | DecisionStatus::Answered | DecisionStatus::Cancelled
            )
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "The native request is already settled",
            ));
        }
        repo.decision_status(id, status)?;
        Ok(true)
    })
}

pub fn expire(repo: &mut impl DecisionRepository, now: i64) -> Result<()> {
    repo.transaction(|repo| {
        for value in repo.pending_decisions()? {
            let value = current(repo, value, now)?;
            if value.status == DecisionStatus::Expired {
                repo.decision_status(&value.header.id, DecisionStatus::Expired)?;
            }
        }
        Ok(())
    })
}
