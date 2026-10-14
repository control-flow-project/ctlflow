use crate::{
    clock::{self, Clock, Scope},
    journal::{Journal, NativeMessage},
};
use crossfire_agent_core::runtime::Approval;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{future::Future, path::Path};
use tokio::sync::{Mutex, MutexGuard};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Receipt {
    Received,
    Absent,
    Cancelled,
    Interrupted,
    Waiting,
}

pub trait Publication<T: NativeMessage>: Send + Sync {
    fn session_id(&self) -> &str;
    fn approval(&self) -> Approval;
    fn lifetime(&self) -> CancellationToken;
    fn verify(&self, cancellation: CancellationToken) -> impl Future<Output = Result<()>> + Send;
    fn inspect(&self) -> impl Future<Output = Result<bool>> + Send;
    fn prepare(
        &self,
        text: &str,
        message_id: &str,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<T>> + Send;
    fn publish(
        &self,
        input: &T,
        journal: &mut Journal<T>,
    ) -> impl Future<Output = Result<()>> + Send;
    fn received(
        &self,
        input: &T,
        journal: &mut Journal<T>,
        cancellation: CancellationToken,
        restored: bool,
    ) -> impl Future<Output = Result<Receipt>> + Send;
    fn cancel(&self, input: &T) -> impl Future<Output = Result<bool>> + Send;
    fn close(&self) -> impl Future<Output = Result<()>> + Send;
}

pub struct Delivery<T: NativeMessage, P, C> {
    native: P,
    clock: C,
    journal: Mutex<Journal<T>>,
    restored: Option<String>,
    poll_ms: u64,
    timeout_ms: u64,
}

impl<T: NativeMessage, P: Publication<T>, C: Clock> Delivery<T, P, C> {
    pub fn open(native: P, clock: C, file: &Path, poll_ms: u64, timeout_ms: u64) -> Result<Self> {
        if !(100..=30_000).contains(&poll_ms) || !(100..=300_000).contains(&timeout_ms) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid native receipt interval or deadline",
            ));
        }
        let journal = Journal::<T>::open(file, native.session_id())?;
        let restored = journal
            .pending()?
            .map(|input| input.message_id().to_owned());
        Ok(Self {
            native,
            clock,
            journal: Mutex::new(journal),
            restored,
            poll_ms,
            timeout_ms,
        })
    }

    pub fn session_id(&self) -> &str {
        self.native.session_id()
    }
    pub fn approval(&self) -> Approval {
        self.native.approval()
    }
    pub fn lifetime(&self) -> CancellationToken {
        self.native.lifetime()
    }

    fn exclusive(&self) -> Result<MutexGuard<'_, Journal<T>>> {
        self.journal.try_lock().map_err(|_| {
            Failure::new(
                ErrorCode::Conflict,
                "Native publication and receipt recovery must be sequential",
            )
        })
    }

    pub async fn inspect(&self) -> Result<bool> {
        clock::check(&self.native.lifetime())?;
        self.native.inspect().await
    }
    pub fn unsettled(&self) -> Result<bool> {
        match self.journal.try_lock() {
            Ok(journal) => journal.unsettled(),
            Err(_) => Ok(true),
        }
    }
    pub fn acknowledge(&self, ids: &[String]) -> Result<()> {
        self.exclusive()?.acknowledge(ids)
    }

    async fn settle_pending(
        &self,
        journal: &mut Journal<T>,
        scope: CancellationToken,
    ) -> Result<Option<Receipt>> {
        if journal.pending()?.is_none() {
            return Ok(None);
        }
        let mut deadline = self.clock.now().saturating_add(self.timeout_ms);
        loop {
            clock::check(&scope)?;
            self.native.verify(scope.clone()).await?;
            let input = journal.pending()?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Native publication evidence disappeared before settlement",
                )
            })?;
            let restored = self.restored.as_deref() == Some(input.message_id());
            let receipt = self
                .native
                .received(&input, journal, scope.clone(), restored)
                .await?;
            clock::check(&scope)?;
            if matches!(
                receipt,
                Receipt::Received | Receipt::Cancelled | Receipt::Interrupted
            ) {
                journal.complete(&input, receipt == Receipt::Received)?;
                return Ok(Some(receipt));
            }
            let now = self.clock.now();
            if receipt == Receipt::Waiting {
                deadline = now.saturating_add(self.timeout_ms);
            }
            if now >= deadline {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Native publication remains uncertain; its journal prevents resubmission and read positions are unchanged",
                ));
            }
            self.clock
                .wait(self.poll_ms.min((deadline - now).max(1)), scope.clone())
                .await?;
        }
    }

    pub async fn settle(&self, cancellation: CancellationToken) -> Result<bool> {
        let mut journal = self.exclusive()?;
        let scope = Scope::new(&self.native.lifetime(), cancellation);
        Ok(self
            .settle_pending(&mut journal, scope.cancellation.clone())
            .await?
            == Some(Receipt::Received))
    }

    pub async fn recover(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
    ) -> Result<bool> {
        let mut journal = self.exclusive()?;
        let scope = Scope::new(&self.native.lifetime(), cancellation);
        if let Some(input) = journal.pending()? {
            if input.text() != text || input.message_id() != id {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Receipt recovery does not match the pending native input",
                ));
            }
            Ok(self
                .settle_pending(&mut journal, scope.cancellation.clone())
                .await?
                == Some(Receipt::Received))
        } else {
            journal.confirmed(text, id)
        }
    }

    async fn cancel_pending(
        &self,
        journal: &mut Journal<T>,
        cancellation: &CancellationToken,
    ) -> Result<()> {
        if cancellation.is_cancelled()
            && !self.native.lifetime().is_cancelled()
            && let Some(input) = journal.pending()?
            && self.native.cancel(&input).await?
        {
            journal.complete(&input, false)?;
        }
        Ok(())
    }

    pub async fn deliver(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
    ) -> Result<()> {
        let mut journal = self.exclusive()?;
        let scope = Scope::new(&self.native.lifetime(), cancellation);
        let scope = &scope.cancellation;
        clock::check(scope)?;
        if journal
            .pending()?
            .is_some_and(|input| input.text() != text || input.message_id() != id)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Settle the preceding native delivery before submitting different input",
            ));
        }
        loop {
            clock::check(scope)?;
            if journal.confirmed(text, id)? {
                return Ok(());
            }
            if journal.pending()?.is_none() {
                self.native.verify(scope.clone()).await?;
                let input = self.native.prepare(text, id, scope.clone()).await?;
                if input.text() != text || input.message_id() != id {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Native input preparation changed its identity or content",
                    ));
                }
                clock::check(scope)?;
                journal.prepare(input)?;
                let input = journal.pending()?.ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Invalid,
                        "Native input disappeared before publication",
                    )
                })?;
                if let Err(failure) = self.native.publish(&input, &mut journal).await {
                    self.cancel_pending(&mut journal, scope).await?;
                    return Err(failure);
                }
            }
            match self.settle_pending(&mut journal, scope.clone()).await {
                Ok(Some(Receipt::Received)) => return Ok(()),
                Ok(Some(Receipt::Interrupted)) => {}
                Ok(_) => {
                    return Err(Failure::new(
                        ErrorCode::Unavailable,
                        "Native input was cancelled before publication; read positions are unchanged",
                    ));
                }
                Err(failure) => {
                    self.cancel_pending(&mut journal, scope).await?;
                    return Err(failure);
                }
            }
        }
    }

    pub async fn close(&self) -> Result<()> {
        let result = self.native.close().await;
        self.journal.lock().await.close();
        result
    }
}
