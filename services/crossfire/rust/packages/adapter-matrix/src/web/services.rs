use crate::{element::Element, web::registration::Registration};
use crossfire_adapter_http::{NativeHttp, public_request_budget::RequestBudget};
use crossfire_domain::{
    member::invitation::InvitationRepository, messaging::MessagingAuthority,
    port::RepositoryAccess, principal::PrincipalRepository, read::port::ReadRepository,
    room_access::operations::RoomOperations,
};
use std::sync::Arc;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

pub trait WebRepository: InvitationRepository + PrincipalRepository + ReadRepository {}
impl<Repository: InvitationRepository + PrincipalRepository + ReadRepository> WebRepository
    for Repository
{
}
pub trait WebRepositoryAccess: RepositoryAccess<Repository: WebRepository> + Send + Sync {}
impl<Access: RepositoryAccess<Repository: WebRepository> + Send + Sync> WebRepositoryAccess
    for Access
{
}

pub struct WebConfiguration {
    pub public_origin: url::Url,
    pub server_name: String,
}
pub struct WebServices<
    Access: WebRepositoryAccess,
    Messaging: MessagingAuthority,
    Operations: RoomOperations,
> {
    pub configuration: WebConfiguration,
    pub repository: Access,
    pub messaging: Arc<Messaging>,
    pub room_operations: Operations,
    pub registration: Registration,
    pub changed: Arc<Notify>,
    pub rate: Arc<RequestBudget>,
    pub proxy: NativeHttp,
    pub element: Element,
    pub stop: CancellationToken,
}
