use super::{boolean, stored_code};
use crate::store::Store;
use crate::{
    error::failure,
    tables::{
        runtime_decision, runtime_decision_answer, runtime_decision_option,
        runtime_decision_question,
    },
};
use crossfire_domain::{
    identity::Page,
    runtime::{port::DecisionRepository, values::*},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
use std::collections::HashMap;

#[derive(Queryable, Selectable)]
#[diesel(table_name = runtime_decision)]
struct SummaryRow {
    id: String,
    agent_id: String,
    run_id: String,
    runtime: String,
    session_id: String,
    request_id: String,
    turn_id: String,
    item_id: String,
    kind: String,
    action: String,
    blocking: i64,
    expires_at: Option<i64>,
    created_at: i64,
    status: String,
}

impl TryFrom<SummaryRow> for DecisionSummary {
    type Error = Failure;
    fn try_from(value: SummaryRow) -> Result<Self> {
        Ok(Self {
            header: DecisionHeader {
                id: value.id,
                run_id: value.run_id,
                runtime: stored_code(Runtime::parse(&value.runtime))?,
                session_id: value.session_id,
                request_id: value.request_id,
                turn_id: value.turn_id,
                item_id: value.item_id,
                kind: stored_code(DecisionKind::parse(&value.kind))?,
                action: value.action,
                blocking: boolean(value.blocking)?,
                expires_at: value.expires_at,
            },
            agent_id: value.agent_id,
            status: stored_code(DecisionStatus::parse(&value.status))?,
            created_at: value.created_at,
        })
    }
}

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = runtime_decision_question)]
struct QuestionRow {
    decision_id: String,
    question_id: String,
    position: i64,
    title: String,
    prompt: String,
    secret: i64,
    allow_text: i64,
}

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = runtime_decision_option)]
struct OptionRow {
    decision_id: String,
    question_id: String,
    option_id: String,
    position: i64,
    label: String,
    description: String,
}

impl DecisionRepository for Store {
    fn decision(&mut self, id: &str) -> Result<Option<Decision>> {
        let row = runtime_decision::table
            .filter(runtime_decision::id.eq(id))
            .select((SummaryRow::as_select(), runtime_decision::review_text))
            .first::<(SummaryRow, String)>(self.database.connection())
            .optional()
            .map_err(failure)?;
        let Some((summary, review)) = row else {
            return Ok(None);
        };
        let questions = runtime_decision_question::table
            .filter(runtime_decision_question::decision_id.eq(id))
            .order(runtime_decision_question::position.asc())
            .select(QuestionRow::as_select())
            .load::<QuestionRow>(self.database.connection())
            .map_err(failure)?;
        let options = runtime_decision_option::table
            .filter(runtime_decision_option::decision_id.eq(id))
            .order(runtime_decision_option::position.asc())
            .select(OptionRow::as_select())
            .load::<OptionRow>(self.database.connection())
            .map_err(failure)?;
        let mut by_question: HashMap<String, Vec<OptionChoice>> = HashMap::new();
        for option in options {
            by_question
                .entry(option.question_id)
                .or_default()
                .push(OptionChoice {
                    id: option.option_id,
                    label: option.label,
                    description: option.description,
                });
        }
        let questions = questions
            .into_iter()
            .map(|question| {
                let options = by_question
                    .remove(&question.question_id)
                    .unwrap_or_default();
                Ok(Question {
                    id: question.question_id,
                    title: question.title,
                    prompt: question.prompt,
                    secret: boolean(question.secret)?,
                    allow_text: boolean(question.allow_text)?,
                    options,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Some(Decision {
            summary: summary.try_into()?,
            review,
            questions,
        }))
    }

    fn decisions(
        &mut self,
        agent_id: &str,
        page: i64,
        page_size: i64,
        status: Option<DecisionStatus>,
    ) -> Result<Page<DecisionSummary>> {
        if !(1..=100_000).contains(&page) || !(1..=100).contains(&page_size) {
            return Err(Failure::new(ErrorCode::Invalid, "Invalid pagination"));
        }
        let filter = runtime_decision::agent_id.eq(agent_id).and(
            status
                .is_none()
                .into_sql::<diesel::sql_types::Bool>()
                .or(runtime_decision::status
                    .nullable()
                    .eq(status.map(DecisionStatus::code))),
        );
        let total_items = runtime_decision::table
            .filter(filter)
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let rows = runtime_decision::table
            .filter(filter)
            .order((
                runtime_decision::created_at.desc(),
                runtime_decision::id.asc(),
            ))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .select(SummaryRow::as_select())
            .load::<SummaryRow>(self.database.connection())
            .map_err(failure)?;
        Ok(Page {
            items: rows
                .into_iter()
                .map(DecisionSummary::try_from)
                .collect::<Result<_>>()?,
            page,
            page_size,
            total_items,
            total_pages: ((total_items + page_size - 1) / page_size).max(1),
        })
    }

    fn pending_decisions(&mut self) -> Result<Vec<DecisionSummary>> {
        runtime_decision::table
            .filter(runtime_decision::status.eq_any(["pending", "answered"]))
            .select(SummaryRow::as_select())
            .load::<SummaryRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(DecisionSummary::try_from)
            .collect()
    }

    fn insert_decision(&mut self, value: &Decision) -> Result<()> {
        let header = &value.summary.header;
        diesel::insert_into(runtime_decision::table)
            .values((
                runtime_decision::id.eq(&header.id),
                runtime_decision::agent_id.eq(&value.summary.agent_id),
                runtime_decision::run_id.eq(&header.run_id),
                runtime_decision::runtime.eq(header.runtime.code()),
                runtime_decision::session_id.eq(&header.session_id),
                runtime_decision::request_id.eq(&header.request_id),
                runtime_decision::turn_id.eq(&header.turn_id),
                runtime_decision::item_id.eq(&header.item_id),
                runtime_decision::kind.eq(header.kind.code()),
                runtime_decision::action.eq(&header.action),
                runtime_decision::review_text.eq(&value.review),
                runtime_decision::blocking.eq(i64::from(header.blocking)),
                runtime_decision::expires_at.eq(header.expires_at),
                runtime_decision::created_at.eq(value.summary.created_at),
                runtime_decision::status.eq(value.summary.status.code()),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        let questions: Vec<_> = value
            .questions
            .iter()
            .enumerate()
            .map(|(position, question)| QuestionRow {
                decision_id: header.id.clone(),
                question_id: question.id.clone(),
                position: position as i64,
                title: question.title.clone(),
                prompt: question.prompt.clone(),
                secret: i64::from(question.secret),
                allow_text: i64::from(question.allow_text),
            })
            .collect();
        diesel::insert_into(runtime_decision_question::table)
            .values(&questions)
            .execute(self.database.connection())
            .map_err(failure)?;
        let options: Vec<_> = value
            .questions
            .iter()
            .flat_map(|question| {
                question
                    .options
                    .iter()
                    .enumerate()
                    .map(move |(position, option)| OptionRow {
                        decision_id: header.id.clone(),
                        question_id: question.id.clone(),
                        option_id: option.id.clone(),
                        position: position as i64,
                        label: option.label.clone(),
                        description: option.description.clone(),
                    })
            })
            .collect();
        diesel::insert_into(runtime_decision_option::table)
            .values(&options)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }

    fn decision_status(&mut self, id: &str, status: DecisionStatus) -> Result<()> {
        diesel::update(runtime_decision::table.filter(runtime_decision::id.eq(id)))
            .set(runtime_decision::status.eq(status.code()))
            .execute(self.database.connection())
            .map_err(failure)?;
        if status != DecisionStatus::Answered {
            diesel::delete(
                runtime_decision_answer::table.filter(runtime_decision_answer::decision_id.eq(id)),
            )
            .execute(self.database.connection())
            .map_err(failure)?;
        }
        Ok(())
    }

    fn answers(&mut self, id: &str) -> Result<Vec<Answer>> {
        let rows: Vec<(String, Option<String>, Option<String>)> = runtime_decision_answer::table
            .filter(runtime_decision_answer::decision_id.eq(id))
            .select((
                runtime_decision_answer::question_id,
                runtime_decision_answer::option_id,
                runtime_decision_answer::answer_text,
            ))
            .load(self.database.connection())
            .map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(|(question_id, option_id, text)| Answer {
                question_id,
                option_id,
                text,
            })
            .collect())
    }

    fn answer(&mut self, id: &str, values: &[Answer]) -> Result<()> {
        let values: Vec<_> = values
            .iter()
            .map(|answer| {
                (
                    runtime_decision_answer::decision_id.eq(id),
                    runtime_decision_answer::question_id.eq(&answer.question_id),
                    runtime_decision_answer::option_id.eq(&answer.option_id),
                    runtime_decision_answer::answer_text.eq(&answer.text),
                )
            })
            .collect();
        diesel::insert_into(runtime_decision_answer::table)
            .values(&values)
            .execute(self.database.connection())
            .map_err(failure)?;
        diesel::update(runtime_decision::table.filter(runtime_decision::id.eq(id)))
            .set(runtime_decision::status.eq("answered"))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
}
