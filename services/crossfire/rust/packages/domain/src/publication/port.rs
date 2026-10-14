use super::values::*;
use crate::{identity::Page, listener::Run, port::ListenerRepository};
use crossfire_kernel::Result;
use std::future::Future;

pub trait PublicationRepository: ListenerRepository {
    fn publication(&mut self, id: &str) -> Result<Option<Record>>;
    fn publication_files(&mut self, id: &str) -> Result<Vec<File>>;
    fn insert_publication(&mut self, value: &Publication, files: &[File]) -> Result<()>;
    fn publication_uploaded(&mut self, id: &str, file_id: &str) -> Result<()>;
    fn publish(&mut self, id: &str, expected_revision: i64, now: i64) -> Result<()>;
    fn fence_publication(&mut self, id: &str, expected_revision: i64, now: i64) -> Result<()>;
    fn publication_cleaned(&mut self, id: &str, now: i64) -> Result<()>;
    fn publication_usage(&mut self, agent_id: &str) -> Result<Usage>;
    fn publications_page(&mut self, input: &Query) -> Result<Page<Record>>;
    fn publications_maintenance(&mut self, now: i64, limit: i64) -> Result<Vec<Publication>>;
    fn public_file(&mut self, key: &str, path: &str) -> Result<Option<(Publication, File)>>;
    fn publication_listener_runs(&mut self, agent_id: &str, since: i64) -> Result<Vec<Run>>;
}
pub trait BinarySource: Send {
    fn length(&self) -> i64;
    fn next(&mut self) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
}
pub trait PublicationStore: Sync {
    type Guard: Send;
    type Reader: BinarySource;
    fn exclusive(&self, id: &str) -> Result<Self::Guard>;
    fn upload(
        &self,
        id: &str,
        file: &File,
        input: impl BinarySource,
    ) -> impl Future<Output = Result<()>> + Send;
    fn verify(&self, id: &str, files: &[File]) -> impl Future<Output = Result<()>> + Send;
    fn read(&self, id: &str, file: &File) -> Result<Self::Reader>;
    fn remove(&self, id: &str) -> Result<()>;
}
