use super::{
    affected,
    rows::{AssignmentRow, DeliveryRow, RuleRow, status},
};
use crate::{
    error::failure,
    store::Store,
    tables::{wake_delivery, wake_rule, wake_rule_agent},
};
use crossfire_domain::wake_up::values::{Assignment, Delivery, DeliveryRepository, Rule};
use crossfire_kernel::Result;
use diesel::{dsl::min, prelude::*};

impl DeliveryRepository for Store {
    fn wake_delivery(&mut self, id: &str) -> Result<Option<Delivery>> {
        wake_delivery::table
            .filter(wake_delivery::id.eq(id))
            .select(DeliveryRow::as_select())
            .first(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Delivery::try_from)
            .transpose()
    }
    fn pending_wake_delivery(&mut self, id: &str) -> Result<Option<Delivery>> {
        wake_delivery::table
            .filter(
                wake_delivery::agent_id
                    .eq(id)
                    .and(wake_delivery::status.eq("pending")),
            )
            .order((wake_delivery::created_at.asc(), wake_delivery::id.asc()))
            .select(DeliveryRow::as_select())
            .first(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Delivery::try_from)
            .transpose()
    }
    fn save_wake_delivery(&mut self, value: &Delivery, insert: bool) -> Result<()> {
        if insert {
            return affected(
                diesel::insert_into(wake_delivery::table)
                    .values(DeliveryRow::from(value))
                    .execute(self.database.connection())
                    .map_err(failure)?,
            );
        }
        affected(
            diesel::update(wake_delivery::table.filter(wake_delivery::id.eq(&value.id)))
                .set((
                    wake_delivery::run_id.eq(&value.run_id),
                    wake_delivery::status.eq(status(value.status)),
                    wake_delivery::delivered_at.eq(value.delivered_at),
                ))
                .execute(self.database.connection())
                .map_err(failure)?,
        )
    }
    fn due_wake_assignments(&mut self, id: &str, now: i64) -> Result<Vec<(Rule, Assignment)>> {
        let rows = wake_rule_agent::table
            .inner_join(wake_rule::table.on(wake_rule_agent::rule_id.eq(wake_rule::id)))
            .filter(
                wake_rule_agent::agent_id
                    .eq(id)
                    .and(wake_rule_agent::next_due_at.le(now))
                    .and(wake_rule::enabled.eq(1)),
            )
            .order((wake_rule_agent::next_due_at.asc(), wake_rule::id.asc()))
            .select((RuleRow::as_select(), AssignmentRow::as_select()))
            .load::<(RuleRow, AssignmentRow)>(self.database.connection())
            .map_err(failure)?;
        rows.into_iter()
            .map(|(rule, assignment)| Ok((rule.try_into()?, assignment.into())))
            .collect()
    }
    fn next_wake_due_at(&mut self, id: &str) -> Result<Option<i64>> {
        wake_rule_agent::table
            .inner_join(wake_rule::table.on(wake_rule_agent::rule_id.eq(wake_rule::id)))
            .filter(
                wake_rule_agent::agent_id
                    .eq(id)
                    .and(wake_rule::enabled.eq(1)),
            )
            .select(min(wake_rule_agent::next_due_at))
            .get_result(self.database.connection())
            .map_err(failure)
    }
}
