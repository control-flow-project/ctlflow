use super::{
    affected,
    rows::{AssignmentRow, RuleRow},
};
use crate::{
    error::failure,
    store::Store,
    tables::{wake_delivery, wake_rule, wake_rule_agent},
};
use crossfire_domain::{
    identity::Page,
    wake_up::values::{Assignment, Rule, RuleRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

impl RuleRepository for Store {
    fn wake_rule(&mut self, id: &str) -> Result<Option<Rule>> {
        wake_rule::table
            .filter(wake_rule::id.eq(id))
            .select(RuleRow::as_select())
            .first(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Rule::try_from)
            .transpose()
    }
    fn save_wake_rule(&mut self, value: &Rule, insert: bool) -> Result<()> {
        let row = RuleRow::from(value);
        let count = if insert {
            diesel::insert_into(wake_rule::table)
                .values(&row)
                .execute(self.database.connection())
        } else {
            diesel::update(wake_rule::table.filter(wake_rule::id.eq(&value.id)))
                .set(&row)
                .execute(self.database.connection())
        };
        affected(count.map_err(failure)?)
    }
    fn remove_wake_rule(&mut self, id: &str) -> Result<()> {
        affected(
            diesel::delete(wake_rule::table.filter(wake_rule::id.eq(id)))
                .execute(self.database.connection())
                .map_err(failure)?,
        )
    }
    fn wake_rules_page(
        &mut self,
        owner_id: Option<&str>,
        search: &str,
        page: i64,
        size: i64,
    ) -> Result<Page<Rule>> {
        if !(1..=100_000).contains(&page) || !(1..=100).contains(&size) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use page >= 1 and pageSize 1-100",
            ));
        }
        let search = format!("%{search}%");
        let mut count = wake_rule::table
            .filter(wake_rule::name.like(&search))
            .into_boxed();
        if let Some(owner) = owner_id {
            count = count.filter(wake_rule::owner_id.eq(owner));
        }
        let total_items: i64 = count
            .count()
            .get_result(self.database.connection())
            .map_err(failure)?;
        let mut query = wake_rule::table
            .filter(wake_rule::name.like(&search))
            .into_boxed();
        if let Some(owner) = owner_id {
            query = query.filter(wake_rule::owner_id.eq(owner));
        }
        let items = query
            .order((wake_rule::created_at.desc(), wake_rule::id.asc()))
            .offset((page - 1) * size)
            .limit(size)
            .select(RuleRow::as_select())
            .load(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Rule::try_from)
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            page,
            page_size: size,
            total_items,
            total_pages: ((total_items + size - 1) / size).max(1),
        })
    }
    fn wake_assignments(&mut self, ids: &[String]) -> Result<Vec<Assignment>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        wake_rule_agent::table
            .filter(wake_rule_agent::rule_id.eq_any(ids))
            .order((
                wake_rule_agent::rule_id.asc(),
                wake_rule_agent::agent_id.asc(),
            ))
            .select(AssignmentRow::as_select())
            .load(self.database.connection())
            .map(|rows: Vec<AssignmentRow>| rows.into_iter().map(Assignment::from).collect())
            .map_err(failure)
    }
    fn save_wake_assignment(&mut self, value: &Assignment) -> Result<()> {
        let row = AssignmentRow::from(value);
        affected(
            diesel::insert_into(wake_rule_agent::table)
                .values(&row)
                .on_conflict((wake_rule_agent::rule_id, wake_rule_agent::agent_id))
                .do_update()
                .set((
                    wake_rule_agent::next_due_at.eq(value.next_due_at),
                    wake_rule_agent::last_delivered_at.eq(value.last_delivered_at),
                ))
                .execute(self.database.connection())
                .map_err(failure)?,
        )
    }
    fn remove_wake_assignment(&mut self, rule_id: &str, agent_id: &str) -> Result<()> {
        affected(
            diesel::delete(
                wake_rule_agent::table.filter(
                    wake_rule_agent::rule_id
                        .eq(rule_id)
                        .and(wake_rule_agent::agent_id.eq(agent_id)),
                ),
            )
            .execute(self.database.connection())
            .map_err(failure)?,
        )
    }
    fn cancel_wake_deliveries(&mut self, rule_id: &str) -> Result<()> {
        diesel::update(
            wake_delivery::table.filter(
                wake_delivery::rule_id
                    .eq(rule_id)
                    .and(wake_delivery::status.eq("pending")),
            ),
        )
        .set(wake_delivery::status.eq("cancelled"))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
}
