use crossfire_agent_core::local_state::LocalState;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{collections::BTreeMap, sync::Mutex};

#[derive(Default)]
pub struct Memory(pub Mutex<BTreeMap<String, Vec<u8>>>);
impl LocalState for Memory {
    fn read(&self, file: &str, maximum: usize) -> Result<Option<Vec<u8>>> {
        let result = self.0.lock().map_err(|_| failure())?.get(file).cloned();
        if result.as_ref().is_some_and(|bytes| bytes.len() > maximum) {
            return Err(Failure::new(ErrorCode::BodyTooLarge, "Fixture read limit"));
        }
        Ok(result)
    }
    fn write(&self, file: &str, bytes: &[u8], maximum: usize) -> Result<()> {
        if bytes.len() > maximum {
            return Err(Failure::new(ErrorCode::BodyTooLarge, "Fixture write limit"));
        }
        self.0
            .lock()
            .map_err(|_| failure())?
            .insert(file.to_owned(), bytes.to_vec());
        Ok(())
    }
    fn remove(&self, file: &str) -> Result<()> {
        self.0.lock().map_err(|_| failure())?.remove(file);
        Ok(())
    }
}
pub fn failure() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Fixture unavailable")
}
