use crossfire_adapter_http::{NativeHttp, operation};
use crossfire_contracts::call::Call;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_contracts::operations::OperationId;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub struct Client {
    transport: operation::Client,
}
impl Client {
    pub fn open(socket: &Path, stop: CancellationToken) -> Result<Self> {
        let key = fleetd_storage::authentication::file_path()
            .and_then(|path| fleetd_storage::authentication::read(&path))
            .map_err(|_| Failure::new(ErrorCode::Unauthorized, "Cannot read the private fleetd authentication configuration; start fleetd to initialize it"))?;
        Self::authenticated(socket, stop, key)
    }
    pub fn authenticated(
        socket: &Path,
        stop: CancellationToken,
        key: crossfire_kernel::secret::Secret,
    ) -> Result<Self> {
        Ok(Self {
            transport: operation::Client::from_http(
                NativeHttp::unix(socket, stop)?,
                Some(key),
                Duration::from_secs(120),
                16 * 1024 * 1024,
            )?,
        })
    }
    pub async fn call(
        &self,
        request: &Call<OperationId>,
        stop: CancellationToken,
    ) -> Result<Value> {
        let response = self.transport.call(request, stop).await?;
        if request.definition()?.collection {
            Ok(json!({"items":response.data,"meta":response.metadata}))
        } else {
            Ok(response.data)
        }
    }
}
