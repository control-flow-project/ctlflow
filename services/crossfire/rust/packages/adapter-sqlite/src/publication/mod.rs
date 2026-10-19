mod rows;
use crate::{
    error::failure,
    listener::ListenerRow,
    store::Store,
    tables::{
        agent, agent_name, listener_run, member, publication as report, publication_file as file,
    },
};
use crossfire_domain::{
    identity::Page,
    listener::Run,
    publication::{port::PublicationRepository, values::*},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{
    dsl::count_star,
    prelude::*,
    sql_types::{BigInt, Nullable},
};
use rows::{FileRow, Row};

#[diesel::declare_sql_function]
extern "SQL" {
    #[aggregate]
    #[sql_name = "sum"]
    fn sum_integer(value: Nullable<BigInt>) -> Nullable<BigInt>;
}
fn affected(count: usize, code: ErrorCode, message: &str) -> Result<()> {
    if count == 1 {
        Ok(())
    } else {
        Err(Failure::new(code, message))
    }
}
macro_rules! records {
    () => {
        report::table
            .inner_join(agent::table.on(agent::principal_id.eq(report::agent_id)))
            .inner_join(
                agent_name::table.on(agent_name::agent_id.eq(agent::principal_id.nullable())),
            )
            .inner_join(member::table.on(member::principal_id.eq(agent::owner_id)))
    };
}
impl PublicationRepository for Store {
    fn publication(&mut self, id: &str) -> Result<Option<Record>> {
        records!()
            .filter(report::id.eq(id))
            .select((
                Row::as_select(),
                agent_name::name,
                agent::owner_id,
                member::display_name,
            ))
            .first::<(Row, String, String, String)>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(rows::record)
            .transpose()
    }
    fn publication_files(&mut self, id: &str) -> Result<Vec<File>> {
        file::table
            .filter(file::publication_id.eq(id))
            .order(file::path)
            .select(FileRow::as_select())
            .load::<FileRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(File::try_from)
            .collect()
    }
    fn insert_publication(&mut self, value: &Publication, files: &[File]) -> Result<()> {
        diesel::insert_into(report::table)
            .values(Row::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        for file in files {
            diesel::insert_into(file::table)
                .values(FileRow::from(file))
                .execute(self.database.connection())
                .map_err(failure)?;
        }
        Ok(())
    }
    fn publication_uploaded(&mut self, id: &str, file_id: &str) -> Result<()> {
        affected(
            diesel::update(
                file::table.filter(file::id.eq(file_id).and(file::publication_id.eq(id))),
            )
            .set(file::uploaded.eq(1_i64))
            .execute(self.database.connection())
            .map_err(failure)?,
            ErrorCode::Missing,
            "Report file not found",
        )
    }
    fn publish(&mut self, id: &str, revision: i64, now: i64) -> Result<()> {
        let next = revision.checked_add(1).ok_or_else(|| {
            Failure::new(ErrorCode::Conflict, "Report revision exceeds native range")
        })?;
        affected(
            diesel::update(
                report::table.filter(
                    report::id
                        .eq(id)
                        .and(report::revision.eq(revision))
                        .and(report::state.eq("staging"))
                        .and(report::expires_at.gt(now)),
                ),
            )
            .set((
                report::state.eq("published"),
                report::revision.eq(next),
                report::published_at.eq(Some(now)),
            ))
            .execute(self.database.connection())
            .map_err(failure)?,
            ErrorCode::Conflict,
            "Report staging changed",
        )
    }
    fn fence_publication(&mut self, id: &str, revision: i64, now: i64) -> Result<()> {
        let next = revision.checked_add(1).ok_or_else(|| {
            Failure::new(ErrorCode::Conflict, "Report revision exceeds native range")
        })?;
        affected(
            diesel::update(
                report::table.filter(
                    report::id
                        .eq(id)
                        .and(report::revision.eq(revision))
                        .and(report::state.ne("deleted")),
                ),
            )
            .set((
                report::state.eq("deleted"),
                report::revision.eq(next),
                report::deleted_at.eq(Some(now)),
            ))
            .execute(self.database.connection())
            .map_err(failure)?,
            ErrorCode::Conflict,
            "Report revision changed",
        )
    }
    fn publication_cleaned(&mut self, id: &str, now: i64) -> Result<()> {
        affected(
            diesel::update(
                report::table.filter(report::id.eq(id).and(report::state.eq("deleted"))),
            )
            .set(report::cleaned_at.eq(Some(now)))
            .execute(self.database.connection())
            .map_err(failure)?,
            ErrorCode::Conflict,
            "Only deleted report storage can be reclaimed",
        )
    }
    fn publication_usage(&mut self, agent_id: &str) -> Result<Usage> {
        let (instance_count, instance_bytes) = report::table
            .filter(report::cleaned_at.is_null())
            .select((count_star(), sum_integer(report::total_bytes.nullable())))
            .first::<(i64, Option<i64>)>(self.database.connection())
            .map_err(failure)?;
        let (agent_count, agent_bytes) = report::table
            .filter(
                report::cleaned_at
                    .is_null()
                    .and(report::agent_id.eq(agent_id)),
            )
            .select((count_star(), sum_integer(report::total_bytes.nullable())))
            .first::<(i64, Option<i64>)>(self.database.connection())
            .map_err(failure)?;
        Ok(Usage {
            instance_bytes: instance_bytes.unwrap_or(0),
            agent_bytes: agent_bytes.unwrap_or(0),
            instance_count,
            agent_count,
        })
    }
    fn publications_page(&mut self, input: &Query) -> Result<Page<Record>> {
        if input.page < 1 || !(1..=100).contains(&input.page_size) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid report pagination",
            ));
        }
        let offset = (input.page - 1)
            .checked_mul(input.page_size)
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Invalid report pagination"))?;
        let search = format!("%{}%", input.search);
        macro_rules! query {
            () => {{
                let mut query = records!().into_boxed();
                if let Some(owner_id) = &input.owner_id {
                    query = query.filter(agent::owner_id.eq(owner_id));
                }
                if let Some(agent_id) = &input.agent_id {
                    query = query.filter(report::agent_id.eq(agent_id));
                }
                if let Some(state) = input.state {
                    query = query.filter(report::state.eq(state.as_str()));
                }
                query.filter(report::title.like(&search))
            }};
        }
        let total_items: i64 = query!()
            .count()
            .get_result(self.database.connection())
            .map_err(failure)?;
        let items = query!()
            .order((report::created_at.desc(), report::id.desc()))
            .offset(offset)
            .limit(input.page_size)
            .select((
                Row::as_select(),
                agent_name::name,
                agent::owner_id,
                member::display_name,
            ))
            .load::<(Row, String, String, String)>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(rows::record)
            .collect::<Result<_>>()?;
        Ok(Page {
            items,
            page: input.page,
            page_size: input.page_size,
            total_items,
            total_pages: (total_items / input.page_size
                + i64::from(total_items % input.page_size != 0))
            .max(1),
        })
    }
    fn publications_maintenance(&mut self, now: i64, limit: i64) -> Result<Vec<Publication>> {
        if !(1..=50).contains(&limit) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid report maintenance batch",
            ));
        }
        report::table
            .filter(
                report::cleaned_at.is_null().and(
                    report::state
                        .eq("deleted")
                        .or(report::state.eq("staging").and(report::expires_at.le(now))),
                ),
            )
            .order((report::expires_at, report::id))
            .limit(limit)
            .select(Row::as_select())
            .load::<Row>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Publication::try_from)
            .collect()
    }
    fn public_file(&mut self, key: &str, path: &str) -> Result<Option<(Publication, File)>> {
        let value = report::table
            .inner_join(file::table.on(file::publication_id.eq(report::id)))
            .filter(
                report::public_key
                    .eq(key)
                    .and(report::state.eq("published"))
                    .and(file::path.eq(path))
                    .and(file::uploaded.eq(1_i64)),
            )
            .select((Row::as_select(), FileRow::as_select()))
            .first::<(Row, FileRow)>(self.database.connection())
            .optional()
            .map_err(failure)?;
        value
            .map(|(report, file)| Ok((report.try_into()?, file.try_into()?)))
            .transpose()
    }
    fn publication_listener_runs(&mut self, id: &str, since: i64) -> Result<Vec<Run>> {
        let rows = listener_run::table
            .filter(
                listener_run::agent_id
                    .eq(id)
                    .and(listener_run::stopped_at.is_null())
                    .and(listener_run::last_seen_at.gt(since)),
            )
            .select(ListenerRow::as_select())
            .load::<ListenerRow>(self.database.connection())
            .map_err(failure)?;
        Ok(rows.into_iter().map(Run::from).collect())
    }
}
