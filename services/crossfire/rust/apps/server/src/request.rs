pub use crossfire_adapter_http::routing::{Selection, decode, path};
use crossfire_adapter_http::server::Method;
use crossfire_contracts::operations;
use crossfire_kernel::Result;
pub fn select(method: &Method, path: &str) -> Result<Selection> {
    crossfire_adapter_http::routing::select(operations::operations(), method, path)
}
