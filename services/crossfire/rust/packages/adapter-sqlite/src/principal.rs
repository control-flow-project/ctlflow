use crate::{error::failure, store::Store, tables::principal_application};
use crossfire_domain::principal::PrincipalRepository;
use crossfire_kernel::Result;
use diesel::prelude::*;
impl PrincipalRepository for Store {
    fn due_principals(&mut self, now: i64) -> Result<Vec<String>> {
        principal_application::table
            .filter(principal_application::next_check_at.le(now))
            .order((
                principal_application::next_check_at.asc(),
                principal_application::principal_id.asc(),
            ))
            .select(principal_application::principal_id)
            .load(self.database.connection())
            .map_err(failure)
    }
}
