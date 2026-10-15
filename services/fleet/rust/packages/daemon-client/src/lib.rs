use crossfire_adapter_http::{NativeHttp, operation};
use crossfire_contracts::call::Call;
use crossfire_kernel::Result;
use fleetd_contracts::operations::OperationId;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub struct Client {
    transport: operation::Client,
}
impl Client {
    pub fn open(socket: &Path, stop: CancellationToken) -> Result<Self> {
        Ok(Self {
            transport: operation::Client::from_http(
                NativeHttp::unix(socket, stop)?,
                None,
                Duration::from_secs(120),
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
