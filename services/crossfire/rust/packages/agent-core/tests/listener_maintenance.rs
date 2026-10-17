mod support;
use crossfire_agent_core::{
    coordination::Coordination,
    listener_maintenance::{Maintenance, Options},
    matrix::{Matrix, Request, Response},
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_kernel::Result;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;
struct Network(Mutex<Vec<Value>>);
impl Coordination for Network {
    fn origin(&self) -> &str {
        "https://crossfire.invalid"
    }
    async fn call(&self, call: &Call, _stop: CancellationToken) -> Result<Value> {
        call.path_parts()?;
        assert!(matches!(call.operation, OperationId::AcceptRoomInvitation));
        let body = call.body.clone().ok_or_else(support::failure)?;
        assert_eq!(body, json!({"roomId":"!invited:local"}));
        self.0.lock().map_err(|_| support::failure())?.push(body);
        Ok(json!({"accepted":true}))
    }
}
impl Matrix for Network {
    async fn request(&self, input: &Request, _stop: CancellationToken) -> Result<Response> {
        assert_eq!(input.path, "/_matrix/client/v3/sync");
        Ok(Response {
            status: 200,
            body: json!({"rooms":{"invite":{"!invited:local":{}}}}),
        })
    }
}
#[tokio::test]
async fn invitation_uses_the_canonical_body_not_an_undeclared_path_parameter()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let network = Arc::new(Network(Mutex::new(vec![])));
    let time = || Ok(1000);
    let maintenance = Maintenance::open(
        Arc::new(support::Memory::default()),
        network.clone(),
        time,
        Options {
            file: "maintenance.json".into(),
            agent_id: "00000000-0000-4000-8000-000000000000".into(),
            interval_ms: 30000,
        },
    )?;
    assert!(
        maintenance
            .publish(network.as_ref(), CancellationToken::new())
            .await?
    );
    assert!(
        !maintenance
            .publish(network.as_ref(), CancellationToken::new())
            .await?
    );
    assert_eq!(network.0.lock().map_err(|_| support::failure())?.len(), 1);
    Ok(())
}
