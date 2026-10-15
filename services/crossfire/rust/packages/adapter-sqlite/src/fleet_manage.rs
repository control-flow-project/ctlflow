use crate::{error::failure, store::Store, tables::fleet_controller_metadata};
use crossfire_domain::fleet::manage::ManageRepository;
use crossfire_kernel::Result;
use diesel::prelude::*;
use std::collections::BTreeMap;
impl ManageRepository for Store {
    fn replace_fleet_metadata(
        &mut self,
        fleet: &str,
        values: &BTreeMap<String, String>,
    ) -> Result<()> {
        diesel::delete(
            fleet_controller_metadata::table.filter(fleet_controller_metadata::fleet_id.eq(fleet)),
        )
        .execute(self.database.connection())
        .map_err(failure)?;
        for (key, value) in values {
            diesel::insert_into(fleet_controller_metadata::table)
                .values((
                    fleet_controller_metadata::fleet_id.eq(fleet),
                    fleet_controller_metadata::key.eq(key),
                    fleet_controller_metadata::value.eq(value),
                ))
                .execute(self.database.connection())
                .map_err(failure)?;
        }
        Ok(())
    }
}
