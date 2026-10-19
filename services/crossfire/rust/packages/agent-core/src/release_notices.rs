use crate::{
    events::invalid,
    local_state::{self, LocalState},
    runtime::Connection,
};
use crossfire_contracts::{release, validation as check};
use crossfire_kernel::{Result, identity};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

pub struct Notices<S> {
    storage: Arc<S>,
    file: String,
    installed: String,
    owner: String,
    session: String,
    pending: Mutex<Option<String>>,
    publication: AsyncMutex<()>,
}
impl<S: LocalState> Notices<S> {
    pub fn open(
        storage: Arc<S>,
        file: &str,
        installed: &str,
        owner: &str,
        session: &str,
    ) -> Result<Self> {
        check::text(&json!(session), 1, 200)?;
        check::backend_user_id(&json!(owner))?;
        release::identity(installed)?;
        let result = Self {
            storage,
            file: format!("{file}.update.{}", identity::hash(session)),
            installed: installed.to_owned(),
            owner: owner.to_owned(),
            session: session.to_owned(),
            pending: Mutex::new(None),
            publication: AsyncMutex::new(()),
        };
        result.notified()?;
        Ok(result)
    }
    fn notified(&self) -> Result<Vec<String>> {
        let releases: Vec<String> =
            local_state::read(self.storage.as_ref(), &self.file, 1048576)?.unwrap_or_default();
        if releases.len() > 4096
            || releases
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != releases.len()
        {
            return Err(invalid("Invalid saved release notices"));
        }
        for value in &releases {
            release::identity(value)?;
        }
        Ok(releases)
    }
    pub fn available(&self, release: &str) -> Result<()> {
        release::identity(release)?;
        *self
            .pending
            .lock()
            .map_err(|_| invalid("Release notice ownership failed"))? = (release != self.installed
            && !self.notified()?.iter().any(|previous| previous == release))
        .then(|| release.to_owned());
        Ok(())
    }
    pub fn pending(&self) -> Result<bool> {
        Ok(self
            .pending
            .lock()
            .map_err(|_| invalid("Release notice ownership failed"))?
            .is_some())
    }
    pub async fn publish(&self, native: &impl Connection, stop: CancellationToken) -> Result<()> {
        let _publication = tokio::select! {
            _ = stop.cancelled() => return Err(invalid("Release notice was cancelled before publication")),
            lease = self.publication.lock() => lease,
        };
        let Some(release) = self
            .pending
            .lock()
            .map_err(|_| invalid("Release notice ownership failed"))?
            .clone()
        else {
            return Ok(());
        };
        if native.session_id() != self.session {
            return Err(invalid(
                "Release notice belongs to a different native history",
            ));
        }
        let mut saved = self.notified()?;
        if saved.len() >= 4096 {
            return Err(invalid("Saved release notices exceed their safety bound"));
        }
        let id = format!(
            "crossfire-update-{}",
            identity::hash(&json!([native.session_id(), release]).to_string())
        );
        native.deliver(&format!("Crossfire software update: release {release} is available. This is a trusted listener maintenance notice, not a room message. Ask the human owner {} whether to update the fleet controller and its installed Crossfire skills. Do not update without consent. Follow the installed Crossfire skill’s controller update workflow after consent. Do not launch another listener. Read changed skill content after the update. Preserve the existing identity, room grants and native history. No other action is authorized by this notice.", self.owner), &id, stop, None).await?;
        saved.push(release.clone());
        local_state::write(self.storage.as_ref(), &self.file, &saved, 1048576)?;
        native.acknowledge(&[id])?;
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| invalid("Release notice ownership failed"))?;
        if pending.as_ref() == Some(&release) {
            *pending = None;
        }
        Ok(())
    }
}
