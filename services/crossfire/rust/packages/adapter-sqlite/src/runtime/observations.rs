use super::{boolean, stored_code};
use crate::store::Store;
use crate::{
    error::failure,
    tables::{listener_run, runtime_observation, runtime_setting},
};
use crossfire_domain::runtime::{port::ObservationRepository, values::*};
use crossfire_kernel::Result;
use diesel::prelude::*;
use std::collections::HashMap;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = runtime_observation, treat_none_as_null = true)]
struct ObservationRow {
    run_id: String,
    agent_id: String,
    session_id: String,
    room_id: Option<String>,
    runtime: String,
    state: String,
    observed_at: i64,
    history_mode: String,
    max_input_bytes: i64,
    error_message: Option<String>,
    last_activity_at: Option<i64>,
    history_available: Option<i64>,
}

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = runtime_setting)]
struct SettingRow {
    run_id: String,
    session_id: String,
    name: String,
    configured_value: Option<String>,
    effective_value: Option<String>,
}

impl ObservationRepository for Store {
    fn native_summaries(
        &mut self,
        agent_ids: &[String],
    ) -> Result<std::collections::BTreeMap<String, Summary>> {
        super::summaries::read(self, agent_ids)
    }
    fn observations(&mut self, agent_id: &str) -> Result<Vec<ObservationView>> {
        let latest = listener_run::table
            .filter(listener_run::agent_id.eq(agent_id))
            .order((listener_run::started_at.desc(), listener_run::id.desc()))
            .select(listener_run::id)
            .first::<String>(self.database.connection())
            .optional()
            .map_err(failure)?;
        let Some(latest) = latest else {
            return Ok(Vec::new());
        };
        let rows = runtime_observation::table
            .filter(runtime_observation::run_id.eq(&latest))
            .order(runtime_observation::observed_at.desc())
            .select(ObservationRow::as_select())
            .load::<ObservationRow>(self.database.connection())
            .map_err(failure)?;
        let settings = runtime_setting::table
            .filter(runtime_setting::run_id.eq(&latest))
            .order(runtime_setting::name.asc())
            .select(SettingRow::as_select())
            .load::<SettingRow>(self.database.connection())
            .map_err(failure)?;
        let mut by_session: HashMap<String, Vec<Setting>> = HashMap::new();
        for setting in settings {
            by_session
                .entry(setting.session_id)
                .or_default()
                .push(Setting {
                    name: setting.name,
                    configured: setting.configured_value,
                    effective: setting.effective_value,
                });
        }
        rows.into_iter()
            .map(|row| {
                let settings = by_session.remove(&row.session_id).unwrap_or_default();
                Ok(ObservationView {
                    run_id: row.run_id,
                    observation: Observation {
                        session_id: row.session_id,
                        room_id: row.room_id,
                        runtime: stored_code(Runtime::parse(&row.runtime))?,
                        state: stored_code(State::parse(&row.state))?,
                        observed_at: row.observed_at,
                        last_activity_at: row.last_activity_at,
                        history_available: row.history_available.map(boolean).transpose()?,
                        history_mode: stored_code(HistoryMode::parse(&row.history_mode))?,
                        max_input_bytes: row.max_input_bytes,
                        settings,
                        error_message: row.error_message,
                    },
                })
            })
            .collect()
    }

    fn save_observation(&mut self, agent_id: &str, value: &ObservationView) -> Result<()> {
        let input = &value.observation;
        let row = ObservationRow {
            run_id: value.run_id.clone(),
            agent_id: agent_id.to_owned(),
            session_id: input.session_id.clone(),
            room_id: input.room_id.clone(),
            runtime: input.runtime.code().to_owned(),
            state: input.state.code().to_owned(),
            observed_at: input.observed_at,
            last_activity_at: input.last_activity_at,
            history_available: input.history_available.map(i64::from),
            history_mode: input.history_mode.code().to_owned(),
            max_input_bytes: input.max_input_bytes,
            error_message: input.error_message.clone(),
        };
        diesel::insert_into(runtime_observation::table)
            .values(&row)
            .on_conflict((runtime_observation::run_id, runtime_observation::session_id))
            .do_update()
            .set(&row)
            .execute(self.database.connection())
            .map_err(failure)?;
        diesel::delete(
            runtime_setting::table.filter(
                runtime_setting::run_id
                    .eq(&value.run_id)
                    .and(runtime_setting::session_id.eq(&input.session_id)),
            ),
        )
        .execute(self.database.connection())
        .map_err(failure)?;
        let settings: Vec<_> = input
            .settings
            .iter()
            .map(|setting| SettingRow {
                run_id: value.run_id.clone(),
                session_id: input.session_id.clone(),
                name: setting.name.clone(),
                configured_value: setting.configured.clone(),
                effective_value: setting.effective.clone(),
            })
            .collect();
        diesel::insert_into(runtime_setting::table)
            .values(&settings)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
}
