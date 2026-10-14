use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_contracts::registry::{self, work_wire};
use fleetd_domain::{model::ResumeWork, resume_work::WorkStore};
use std::path::Path;

pub struct Work {
    directory: PrivateDirectory,
}
impl Work {
    pub fn open(state: &Path) -> Result<Self> {
        Ok(Self {
            directory: PrivateDirectory::open(state, true)?,
        })
    }
}
impl WorkStore for Work {
    fn work(&self) -> Result<Vec<ResumeWork>> {
        match self
            .directory
            .read_optional("resume-work.json", 2 * 1024 * 1024)?
        {
            None => Ok(vec![]),
            Some(bytes) => registry::work(&serde_json::from_slice(&bytes).map_err(|_| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Malformed private interrupted-work checkpoints",
                )
            })?),
        }
    }
    fn save_work(&self, values: &[ResumeWork]) -> Result<()> {
        let value = work_wire(values);
        registry::work(&value)?;
        let bytes = serde_json::to_vec(&value).map_err(|_| {
            Failure::new(
                ErrorCode::Invalid,
                "Cannot represent interrupted-work checkpoints",
            )
        })?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Interrupted-work checkpoints exceed their byte bound",
            ));
        }
        self.directory.write_atomic("resume-work.json", &bytes)
    }
}
