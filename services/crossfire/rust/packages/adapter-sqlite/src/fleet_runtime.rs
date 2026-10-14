use crate::store::Store;
use crate::{error::failure, tables::fleet_runtime_operation as operation};
use crossfire_domain::{
    fleet::runtime::{Action, Operation, Repository, Status},
    identity::Page,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = operation)]
struct Row {
    id: String,
    fleet_id: String,
    agent_id: Option<String>,
    author_principal_id: String,
    action: String,
    expected_revision: i64,
    status: String,
    created_at: i64,
    completed_at: Option<i64>,
    error_message: Option<String>,
    connection_id: Option<String>,
    credential_id: Option<String>,
}

impl TryFrom<Row> for Operation {
    type Error = Failure;
    fn try_from(row: Row) -> Result<Self> {
        Ok(Self {
            operation_id: row.id,
            fleet_id: row.fleet_id,
            agent_id: row.agent_id,
            author_principal_id: row.author_principal_id,
            action: Action::parse(&row.action).map_err(|_| {
                Failure::new(ErrorCode::Unavailable, "Stored fleet action is invalid")
            })?,
            expected_revision: row.expected_revision,
            status: Status::parse(&row.status).map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Stored fleet operation status is invalid",
                )
            })?,
            created_at: row.created_at,
            completed_at: row.completed_at,
            error_message: row.error_message,
            connection_id: row.connection_id,
            credential_id: row.credential_id,
        })
    }
}

impl Repository for Store {
    fn runtime_operation(&mut self, id: &str) -> Result<Option<Operation>> {
        operation::table
            .filter(operation::id.eq(id))
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Operation::try_from)
            .transpose()
    }
    fn pending_runtime_operation(&mut self, fleet_id: &str) -> Result<Option<Operation>> {
        operation::table
            .filter(
                operation::fleet_id
                    .eq(fleet_id)
                    .and(operation::status.eq_any(["pending", "running"])),
            )
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Operation::try_from)
            .transpose()
    }
    fn runtime_operations(
        &mut self,
        fleet_id: &str,
        page: i64,
        page_size: i64,
    ) -> Result<Page<Operation>> {
        if !(1..=100_000).contains(&page) || !(1..=100).contains(&page_size) {
            return Err(Failure::new(ErrorCode::Invalid, "Invalid pagination"));
        }
        let total_items = operation::table
            .filter(operation::fleet_id.eq(fleet_id))
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let rows = operation::table
            .filter(operation::fleet_id.eq(fleet_id))
            .order((operation::created_at.desc(), operation::id.desc()))
            .offset((page - 1) * page_size)
            .limit(page_size)
            .select(Row::as_select())
            .load::<Row>(self.database.connection())
            .map_err(failure)?;
        Ok(Page {
            items: rows
                .into_iter()
                .map(Operation::try_from)
                .collect::<Result<_>>()?,
            page,
            page_size,
            total_items,
            total_pages: ((total_items + page_size - 1) / page_size).max(1),
        })
    }
    fn insert_runtime_operation(&mut self, value: &Operation) -> Result<()> {
        let row = Row {
            id: value.operation_id.clone(),
            fleet_id: value.fleet_id.clone(),
            agent_id: value.agent_id.clone(),
            author_principal_id: value.author_principal_id.clone(),
            action: value.action.code().to_owned(),
            expected_revision: value.expected_revision,
            status: value.status.code().to_owned(),
            created_at: value.created_at,
            completed_at: value.completed_at,
            error_message: value.error_message.clone(),
            connection_id: value.connection_id.clone(),
            credential_id: value.credential_id.clone(),
        };
        diesel::insert_into(operation::table)
            .values(row)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_runtime_operation(&mut self, value: &Operation) -> Result<()> {
        diesel::update(operation::table.filter(operation::id.eq(&value.operation_id)))
            .set((
                operation::status.eq(value.status.code()),
                operation::completed_at.eq(value.completed_at),
                operation::error_message.eq(&value.error_message),
                operation::connection_id.eq(&value.connection_id),
                operation::credential_id.eq(&value.credential_id),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
}
