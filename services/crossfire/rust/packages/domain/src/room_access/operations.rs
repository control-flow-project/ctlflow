use crossfire_kernel::Result;
pub trait RoomOperations: Send + Sync {
    type Guard: Send;
    fn acquire(&self, key: &str) -> impl std::future::Future<Output = Result<Self::Guard>> + Send;
}
