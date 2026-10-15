use crate::native::Adapter;
use crossfire_agent_core::{
    listener::Factory,
    owned_runtime::{Input, OwnedAdapter},
    runtime::{Hooks, Lifecycle},
};
use crossfire_domain::runtime::values::HistoryMode;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use fleetd_domain::{
    native_lifecycle::{Initial, Logical, Owner},
    resume_work::WorkStore,
};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Template {
    pub profile: String,
    pub name: String,
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub instructions: String,
    pub options: Value,
    pub history_mode: HistoryMode,
    pub initial: Initial,
    pub allow_new_history: bool,
}
pub type NativeOwner<H, W, T> = Owner<Adapter, H, W, T>;
type OwnerSlot<H, W, T> = Arc<Mutex<Option<Arc<NativeOwner<H, W, T>>>>>;
pub struct RuntimeStart<
    H: Hooks + 'static,
    W: WorkStore + Send + Sync + 'static,
    T: Clock + Send + Sync + 'static,
> {
    pub adapter: Arc<Adapter>,
    pub template: Template,
    pub work: Arc<W>,
    pub clock: T,
    owner: OwnerSlot<H, W, T>,
}
impl<
    H: Hooks + 'static,
    W: WorkStore + Send + Sync + 'static,
    T: Clock + Clone + Send + Sync + 'static,
> Clone for RuntimeStart<H, W, T>
{
    fn clone(&self) -> Self {
        Self {
            adapter: self.adapter.clone(),
            template: self.template.clone(),
            work: self.work.clone(),
            clock: self.clock.clone(),
            owner: self.owner.clone(),
        }
    }
}
impl<
    H: Hooks + 'static,
    W: WorkStore + Send + Sync + 'static,
    T: Clock + Clone + Send + Sync + 'static,
> RuntimeStart<H, W, T>
{
    pub fn new(adapter: Arc<Adapter>, template: Template, work: Arc<W>, clock: T) -> Result<Self> {
        <Adapter as OwnedAdapter<H>>::validate(adapter.as_ref(), &template.options)?;
        if template.profile.is_empty()
            || template.name.is_empty()
            || !template.workspace.is_absolute()
            || !template.state_directory.is_absolute()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Owned runtime startup requires its exact profile and absolute private workspace/state directories",
            ));
        }
        Ok(Self {
            adapter,
            template,
            work,
            clock,
            owner: Arc::new(Mutex::new(None)),
        })
    }
    pub async fn maintain(&self) -> Result<()> {
        let owner = self.owner.lock().await.clone();
        if let Some(owner) = owner {
            owner.maintain().await?;
        }
        Ok(())
    }
    pub fn owner(&self) -> Result<Option<Arc<NativeOwner<H, W, T>>>> {
        Ok(self
            .owner
            .try_lock()
            .map_err(|_| Failure::new(ErrorCode::Conflict, "Native startup is still in progress"))?
            .clone())
    }
    pub fn state(&self) -> Result<Option<crossfire_agent_core::runtime::SessionState>> {
        self.owner
            .try_lock()
            .map_err(|_| Failure::new(ErrorCode::Conflict, "Native startup is still in progress"))?
            .as_ref()
            .map(|owner| owner.current())
            .transpose()
    }
    pub async fn stop(&self, preserve_work: bool) -> Result<()> {
        let owner = self.owner.lock().await.clone();
        if let Some(owner) = owner {
            owner.stop_native(preserve_work).await?;
        }
        Ok(())
    }
}
impl<
    H: Hooks + 'static,
    W: WorkStore + Send + Sync + 'static,
    T: Clock + Clone + Send + Sync + 'static,
> Factory<H> for RuntimeStart<H, W, T>
{
    type Native = Logical<Adapter, H, W, T>;
    async fn start(&self, hooks: Arc<H>, stop: CancellationToken) -> Result<Self::Native> {
        let mut current = self.owner.lock().await;
        if current.is_some() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "This exact native startup scope already owns a runtime",
            ));
        }
        let template = &self.template;
        let input = Input {
            profile: template.profile.clone(),
            name: template.name.clone(),
            workspace: template.workspace.clone(),
            state_directory: template.state_directory.clone(),
            instructions: template.instructions.clone(),
            options: template.options.clone(),
            hooks,
            history_mode: template.history_mode,
            allow_new_history: template.allow_new_history,
        };
        let owner = Owner::open(
            self.adapter.clone(),
            input,
            self.work.clone(),
            self.clock.clone(),
            template.initial,
            stop,
        )
        .await?;
        let native = match owner.runtime() {
            Ok(native) => native,
            Err(error) => {
                owner.close().await?;
                return Err(error);
            }
        };
        *current = Some(owner);
        Ok(native)
    }
}
