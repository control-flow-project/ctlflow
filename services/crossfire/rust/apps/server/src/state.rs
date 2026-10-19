use crate::configuration::Configuration;
use crossfire_adapter_filesystem::{publication, release::Release};
use crossfire_adapter_http::{messaging::MessagingHttp, public_request_budget::RequestBudget};
use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_contracts::enrollment::Digest;
use crossfire_domain::messaging::MessagingAuthority;
use crossfire_kernel::{Result, identity};
use std::sync::Arc;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

pub struct State<M: MessagingAuthority> {
    pub configuration: Configuration,
    pub repository: SharedStore,
    pub messaging: Arc<M>,
    pub backend: Arc<dyn MessagingHttp>,
    pub room_operations: crossfire_adapter_runtime::room_operations::Operations,
    pub release: Release,
    pub assets: crate::assets::Assets,
    pub digest: Digest,
    pub publications: publication::Store,
    pub public_reads: std::sync::Arc<tokio::sync::Semaphore>,
    pub started_at: i64,
    pub rate: Arc<RequestBudget>,
    pub changed: Arc<Notify>,
    pub stop: CancellationToken,
    pub diagnostics: std::sync::Arc<crossfire_adapter_filesystem::logging::Store>,
}
impl<M: MessagingAuthority> State<M> {
    pub fn publications(
        &self,
    ) -> crossfire_domain::publication::service::Service<
        '_,
        SharedStore,
        publication::Store,
        fn() -> Result<i64>,
    > {
        static CLOCK: fn() -> Result<i64> = identity::now;
        crossfire_domain::publication::service::Service {
            repository: &self.repository,
            storage: &self.publications,
            clock: &CLOCK,
            origin: self
                .configuration
                .content_origin
                .as_str()
                .trim_end_matches('/'),
            budget: self.configuration.publication_budget,
        }
    }
    pub fn rooms(
        &self,
    ) -> crossfire_domain::room_access::service::Service<'_, SharedStore, M, fn() -> Result<i64>>
    {
        static CLOCK: fn() -> Result<i64> = identity::now;
        crossfire_domain::room_access::service::Service {
            repository: &self.repository,
            messaging: self.messaging.as_ref(),
            clock: &CLOCK,
        }
    }
}
