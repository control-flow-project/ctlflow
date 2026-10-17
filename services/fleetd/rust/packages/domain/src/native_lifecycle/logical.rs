use super::*;

struct Call<'a>(&'a AtomicUsize);
impl Drop for Call<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Logical<A, H, W, T>
{
    fn entered(&self) -> Call<'_> {
        self.owner.calls.fetch_add(1, Ordering::AcqRel);
        Call(&self.owner.calls)
    }
    async fn select(
        &self,
        native: &A::Connection,
        admission: Option<&Admission>,
    ) -> Result<Option<A::Connection>> {
        let selected = match &self.room {
            Some(room) => Some(native.conversation(room, admission).await?),
            None => None,
        };
        let target = selected.as_ref().unwrap_or(native);
        if target.session_id() != self.session {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Selected room history is not the exact saved native history",
            ));
        }
        Ok(selected)
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Connection for Logical<A, H, W, T>
{
    fn session_id(&self) -> &str {
        &self.session
    }
    fn approval(&self) -> Approval {
        self.owner.approval
    }
    fn lifetime(&self) -> CancellationToken {
        self.owner.stop.clone()
    }
    async fn inspect(&self) -> Result<bool> {
        let (native, pending, phase) = {
            let state = self.owner.state.lock().map_err(|_| ownership())?;
            (
                state.native.clone(),
                !state.unsettled.is_empty(),
                state.phase,
            )
        };
        match native {
            Some(native) if !native.lifetime().is_cancelled() => Ok(native.inspect().await?
                || pending
                || self.owner.calls.load(Ordering::Acquire) != 0),
            _ => Ok(matches!(phase, Phase::Waking | Phase::Failed)),
        }
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        stop: CancellationToken,
        priority: Option<InputPriority>,
    ) -> Result<()> {
        let _call = self.entered();
        self.owner.touch(Some(message))?;
        if stop.is_cancelled() {
            return Err(unavailable("Native input cancelled before admission"));
        }
        let admission = priority.map(|priority| Admission {
            priority,
            cancellation: stop.clone(),
        });
        let native = self.owner.ensure(admission.as_ref()).await?;
        let selected = self.select(native.as_ref(), admission.as_ref()).await?;
        selected
            .as_ref()
            .unwrap_or(native.as_ref())
            .deliver(text, message, stop, priority)
            .await
    }
    async fn settle(&self, stop: CancellationToken) -> Result<bool> {
        let _call = self.entered();
        if self
            .owner
            .state
            .lock()
            .map_err(|_| ownership())?
            .native
            .is_none()
            && !self.owner.input.hooks.pending_input()
            && !self.owner.input.hooks.pending_decisions()
        {
            return Ok(false);
        }
        let native = self.owner.ensure(None).await?;
        let selected = self.select(native.as_ref(), None).await?;
        selected
            .as_ref()
            .unwrap_or(native.as_ref())
            .settle(stop)
            .await
    }
    async fn recover(&self, text: &str, message: &str, stop: CancellationToken) -> Result<bool> {
        let _call = self.entered();
        self.owner.touch(Some(message))?;
        let native = self.owner.ensure(None).await?;
        let selected = self.select(native.as_ref(), None).await?;
        let received = selected
            .as_ref()
            .unwrap_or(native.as_ref())
            .recover(text, message, stop)
            .await?;
        if !received {
            self.owner
                .state
                .lock()
                .map_err(|_| ownership())?
                .unsettled
                .remove(message);
        }
        Ok(received)
    }
    fn acknowledge(&self, messages: &[String]) -> Result<()> {
        if messages.is_empty() {
            return Ok(());
        }
        let native = self
            .owner
            .state
            .lock()
            .map_err(|_| ownership())?
            .native
            .clone()
            .ok_or_else(|| {
                unavailable("Exact receipt acknowledgment is awaiting native recovery")
            })?;
        native.acknowledge(messages)?;
        let mut state = self.owner.state.lock().map_err(|_| ownership())?;
        for message in messages {
            state.unsettled.remove(message);
        }
        Ok(())
    }
    async fn conversation(&self, room: &str, admission: Option<&Admission>) -> Result<Self> {
        let _call = self.entered();
        let native = self.owner.ensure(admission).await?;
        let selected = native.conversation(room, admission).await?;
        let contexts = self.owner.contexts().await?;
        self.owner.state.lock().map_err(|_| ownership())?.contexts = contexts;
        Ok(Self {
            owner: self.owner.clone(),
            room: Some(room.to_owned()),
            session: selected.session_id().to_owned(),
        })
    }
    async fn close(&self) -> Result<()> {
        self.owner.close().await
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> TurnControl for Logical<A, H, W, T>
{
    async fn active_turn(
        &self,
        room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        let _call = self.entered();
        let native = if admission.is_some() {
            Some(self.owner.ensure(admission).await?)
        } else {
            self.owner
                .state
                .lock()
                .map_err(|_| ownership())?
                .native
                .clone()
        };
        match native {
            Some(native) if !native.lifetime().is_cancelled() => {
                native
                    .active_turn(room.or(self.room.as_deref()), admission)
                    .await
            }
            _ => Ok(None),
        }
    }
    async fn interrupt(
        &self,
        turn: &str,
        recovery: bool,
        admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        let _call = self.entered();
        let native = self.owner.ensure(admission).await?;
        native.interrupt(turn, recovery, admission).await
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> OwnedConnection for Logical<A, H, W, T>
{
    fn attachment(&self) -> Option<Attachment> {
        self.owner
            .state
            .lock()
            .ok()
            .and_then(|state| state.native.as_ref().and_then(|native| native.attachment()))
    }
    async fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        let native = self
            .owner
            .state
            .lock()
            .map_err(|_| ownership())?
            .native
            .clone();
        match native {
            Some(native) => native.attachments().await,
            None => Ok(Vec::new()),
        }
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Lifecycle for Logical<A, H, W, T>
{
    fn current(&self) -> Result<SessionState> {
        self.owner.current()
    }
    fn configure_idle(&self, seconds: i64) -> Result<()> {
        self.owner.configure_idle(seconds)
    }
}
