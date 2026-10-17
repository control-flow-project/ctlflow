use crate::{
    request::{Query, Selection},
    security::Authenticated,
    state::State,
};
use crossfire_adapter_sqlite::store::Store;
use crossfire_contracts::validation as check;
use crossfire_domain::{identity::Actor, port::RepositoryAccess};
use crossfire_kernel::{Result, identity};
use serde_json::Value;
pub struct Context<'a> {
    pub state: &'a State,
    pub selection: Selection,
    pub auth: Authenticated,
    pub query: Query,
    pub input: Value,
    pub request_id: String,
}
impl Context<'_> {
    pub fn actor(&self) -> Result<&Actor> {
        self.auth.actor()
    }
    pub fn parameter(&self, name: &str) -> Result<&str> {
        self.selection.parameter(name)
    }
    pub fn with<T>(&self, operation: impl FnOnce(&mut Store, i64) -> Result<T>) -> Result<T> {
        self.state
            .repository
            .with(|repo| operation(repo, identity::now()?))
    }
    pub fn empty(&self) -> Result<()> {
        check::object(&self.input, &[], &[])?;
        Ok(())
    }
}
