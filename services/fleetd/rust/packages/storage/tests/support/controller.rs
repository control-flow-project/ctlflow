use crossfire_agent_core::{
    owned_runtime::{Attachment, SavedContext},
    runtime::{Phase, SessionState},
    synchronization::CancellationToken,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::{controller_model::*, controller_ports::Execution, model::*};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

#[derive(Default)]
pub struct Calls {
    pub starts: AtomicUsize,
    pub closes: AtomicUsize,
    pub close_fails: AtomicBool,
    pub runtimes: Mutex<BTreeMap<String, Arc<Agent>>>,
}
pub struct Agent {
    session: String,
    stop: CancellationToken,
    calls: Arc<Calls>,
}
impl RunningAgent for Agent {
    fn session_id(&self) -> &str {
        &self.session
    }
    fn lifetime(&self) -> CancellationToken {
        self.stop.clone()
    }
    fn deliberately_stopped(&self) -> bool {
        false
    }
    fn listener_active(&self) -> Result<bool> {
        Ok(!self.stop.is_cancelled())
    }
    fn native_state(&self) -> Result<SessionState> {
        Ok(SessionState {
            phase: Phase::Running,
            last_activity_at: Some(1),
            history_available: true,
        })
    }
    fn resume(&self) -> Response<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn attachment(&self, _context: Option<&str>) -> Response<'_, Attachment> {
        Box::pin(async { Err(Failure::new(ErrorCode::Conflict, "Fixture has no terminal")) })
    }
    fn contexts(&self) -> Response<'_, Vec<SavedContext>> {
        Box::pin(async { Ok(vec![]) })
    }
    fn close(&self) -> Response<'_, ()> {
        Box::pin(async {
            if self.calls.close_fails.load(Ordering::SeqCst) {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Fixture process close is not proven",
                ));
            }
            self.calls.closes.fetch_add(1, Ordering::SeqCst);
            self.stop.cancel();
            Ok(())
        })
    }
}
pub struct Host(pub Arc<Calls>);
impl Execution for Host {
    fn connect(
        &self,
        _configuration: &Configuration,
        _stop: CancellationToken,
        _operations: Weak<dyn RemoteOperations>,
    ) -> Result<()> {
        Ok(())
    }
    fn connection(&self, _configuration: &Configuration) -> Result<ConnectionState> {
        Ok(ConnectionState {
            connected: true,
            delivery_enabled: true,
            revision: Some(1),
            error: None,
        })
    }
    async fn delivery(
        &self,
        _configuration: &Configuration,
        _revision: i64,
        enabled: bool,
        _stop: CancellationToken,
    ) -> Result<Value> {
        Ok(json!({"deliveryEnabled":enabled,"revision":1}))
    }
    async fn message(
        &self,
        _configuration: &Configuration,
        id: &str,
        _body: &str,
        _stop: CancellationToken,
    ) -> Result<Value> {
        Ok(json!({"messageId":id}))
    }
    async fn disconnect(&self, _configuration: &Configuration) -> Result<()> {
        Ok(())
    }
    fn validate(&self, _configuration: &Configuration) -> Result<()> {
        Ok(())
    }
    async fn inspect(
        &self,
        _configuration: &Configuration,
        _instances: &[Instance],
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn test(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn prepare(
        &self,
        _configuration: &Configuration,
        _controller: &ControllerIdentity,
        _enroll: bool,
        _approval: Arc<dyn Fn(ApprovalLink) -> Result<()> + Send + Sync>,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn start(
        &self,
        _configuration: &Configuration,
        instance: &Instance,
        _recovery: bool,
        _stop: CancellationToken,
    ) -> Result<Arc<dyn RunningAgent>> {
        self.0.starts.fetch_add(1, Ordering::SeqCst);
        let agent = Arc::new(Agent {
            session: format!("saved-{}", instance.key),
            stop: CancellationToken::new(),
            calls: self.0.clone(),
        });
        self.0
            .runtimes
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Fixture ownership"))?
            .insert(instance.key.clone(), agent.clone());
        Ok(agent)
    }
    async fn contexts(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
    ) -> Result<Vec<SavedContext>> {
        Ok(vec![])
    }
    async fn confirm_stopped(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn reset(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
        _id: &str,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn remove(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn archive(
        &self,
        _configuration: &Configuration,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
    async fn update(
        &self,
        _configuration: &Configuration,
        _instance: &Instance,
        _directory: &Path,
        _stop: CancellationToken,
    ) -> Result<()> {
        Ok(())
    }
}
