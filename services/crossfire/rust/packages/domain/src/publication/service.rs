use super::{
    port::*,
    read::{self, Action},
    validation,
    values::*,
};
use crate::{
    identity::Actor,
    port::{Audit, AuthorizationRepository, CoreRepository, RepositoryAccess, UnitOfWork},
};
use crossfire_kernel::time::Clock;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};

pub struct Service<'a, Access, Storage, Time> {
    pub repository: &'a Access,
    pub storage: &'a Storage,
    pub clock: &'a Time,
    pub origin: &'a str,
    pub budget: Budget,
}
fn conflict(message: &str) -> Failure {
    Failure::new(ErrorCode::Conflict, message)
}
impl<Access, Storage, Time> Service<'_, Access, Storage, Time>
where
    Access: RepositoryAccess,
    Access::Repository: PublicationRepository,
    Storage: PublicationStore,
    Time: Clock,
{
    pub fn create(&self, actor: &Actor, input: &Creation, request_id: &str) -> Result<Details> {
        let bytes = validation::manifest(input)?;
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                read::publisher(repo, actor, now)?;
                let usage = repo.publication_usage(&actor.principal_id)?;
                let budget = self.budget;
                if usage
                    .instance_bytes
                    .checked_add(bytes)
                    .is_none_or(|count| count > budget.instance_bytes)
                    || usage
                        .agent_bytes
                        .checked_add(bytes)
                        .is_none_or(|count| count > budget.agent_bytes)
                    || usage.instance_count >= budget.instance_count
                    || usage.agent_count >= budget.agent_count
                {
                    return Err(Failure::new(
                        ErrorCode::Capacity,
                        "Report storage capacity reached; remove unused reports before publishing",
                    ));
                }
                let id = identity::id();
                let value = Publication {
                    id: id.clone(),
                    agent_id: actor.principal_id.clone(),
                    public_key: identity::secret()?.expose().to_owned(),
                    title: input.title.clone(),
                    state: State::Staging,
                    revision: 0,
                    created_at: now,
                    expires_at: now
                        .checked_add(STAGING_MS)
                        .ok_or_else(|| conflict("Report staging timestamp exceeds native range"))?,
                    published_at: None,
                    deleted_at: None,
                    cleaned_at: None,
                    total_bytes: bytes,
                    file_count: input.files.len() as i64,
                };
                let files: Vec<_> = input
                    .files
                    .iter()
                    .map(|file| File {
                        id: identity::id(),
                        publication_id: id.clone(),
                        manifest: file.clone(),
                        uploaded: false,
                    })
                    .collect();
                repo.insert_publication(&value, &files)?;
                let owner = repo
                    .agent(&actor.principal_id)?
                    .ok_or_else(|| conflict("Publisher identity changed"))?
                    .owner_id;
                repo.audit(&Audit::new(
                    actor,
                    request_id,
                    "publication",
                    &id,
                    "publication.create",
                    Some(&owner),
                    now,
                ))?;
                read::details(repo, self.origin, actor, &id, now)
            })
        })
    }
    pub async fn upload(
        &self,
        actor: &Actor,
        id: &str,
        file_id: &str,
        input: impl BinarySource,
    ) -> Result<()> {
        let _guard = self.storage.exclusive(id)?;
        let file = self.repository.with(|repo| {
            let now = self.clock.now()?;
            let record = read::authority(repo, actor, id, Action::Publish, now)?;
            if record.publication.state != State::Staging || record.publication.expires_at <= now {
                return Err(conflict("Report staging is no longer writable"));
            }
            let file = repo
                .publication_files(id)?
                .into_iter()
                .find(|file| file.id == file_id)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Missing, "Declared report file not found")
                })?;
            if input.length() != file.manifest.bytes {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Upload size does not match its declared file",
                ));
            }
            Ok(file)
        })?;
        self.storage.upload(id, &file, input).await?;
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                let record = read::authority(repo, actor, id, Action::Publish, now)?;
                if record.publication.state != State::Staging
                    || record.publication.expires_at <= now
                {
                    return Err(conflict("Report staging changed during upload"));
                }
                repo.publication_uploaded(id, file_id)
            })
        })
    }
    pub async fn commit(
        &self,
        actor: &Actor,
        id: &str,
        revision: i64,
        request_id: &str,
    ) -> Result<Details> {
        let _guard = self.storage.exclusive(id)?;
        let files = self.repository.with(|repo| {
            let now = self.clock.now()?;
            let value = read::authority(repo, actor, id, Action::Publish, now)?.publication;
            if value.state == State::Published && value.revision.checked_sub(1) == Some(revision) {
                return Ok(None);
            }
            if value.state != State::Staging
                || value.revision != revision
                || value.expires_at <= now
            {
                return Err(conflict("Report staging or revision changed"));
            }
            let files = repo.publication_files(id)?;
            if !files.iter().all(|file| file.uploaded) {
                return Err(conflict(
                    "Every declared report file must be uploaded before publication",
                ));
            }
            Ok(Some(files))
        })?;
        let Some(files) = files else {
            return self
                .repository
                .with(|repo| read::details(repo, self.origin, actor, id, self.clock.now()?));
        };
        self.storage.verify(id, &files).await?;
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                let record = read::authority(repo, actor, id, Action::Publish, now)?;
                if record.publication.state != State::Staging
                    || record.publication.revision != revision
                    || record.publication.expires_at <= now
                {
                    return Err(conflict("Report staging changed during verification"));
                }
                repo.publish(id, revision, now)?;
                repo.audit(&Audit::new(
                    actor,
                    request_id,
                    "publication",
                    id,
                    "publication.publish",
                    Some(&record.owner_id),
                    now,
                ))?;
                read::details(repo, self.origin, actor, id, now)
            })
        })
    }
    pub fn delete(&self, actor: &Actor, id: &str, revision: i64, request_id: &str) -> Result<()> {
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                let record = read::authority(repo, actor, id, Action::Delete, now)?;
                if record.publication.state == State::Deleted
                    && record.publication.revision.checked_sub(1) == Some(revision)
                {
                    return Ok(());
                }
                if record.publication.revision != revision
                    || record.publication.state == State::Deleted
                {
                    return Err(conflict("Report revision changed"));
                }
                repo.fence_publication(id, revision, now)?;
                repo.audit(&Audit::new(
                    actor,
                    request_id,
                    "publication",
                    id,
                    "publication.delete",
                    Some(&record.owner_id),
                    now,
                ))
            })
        })?;
        if let Ok(_guard) = self.storage.exclusive(id)
            && self.storage.remove(id).is_ok()
        {
            let _cleanup = self
                .repository
                .with(|repo| repo.publication_cleaned(id, self.clock.now()?));
        }
        Ok(())
    }
    pub fn maintain(&self) -> Result<usize> {
        let pending = self
            .repository
            .with(|repo| repo.publications_maintenance(self.clock.now()?, 50))?;
        let mut completed = 0;
        let mut failure = None;
        for value in pending {
            let result: Result<bool> = (|| {
                let _guard = self.storage.exclusive(&value.id)?;
                let clean = self.repository.with(|repo| {
                    repo.transaction(|repo| {
                        let now = self.clock.now()?;
                        let Some(record) = repo.publication(&value.id)? else {
                            return Ok(false);
                        };
                        if record.publication.cleaned_at.is_some()
                            || record.publication.state == State::Published
                        {
                            return Ok(false);
                        }
                        if record.publication.state == State::Staging {
                            if record.publication.expires_at > now {
                                return Ok(false);
                            }
                            repo.fence_publication(&value.id, record.publication.revision, now)?;
                        }
                        Ok(true)
                    })
                })?;
                if !clean {
                    return Ok(false);
                }
                self.storage.remove(&value.id)?;
                self.repository
                    .with(|repo| repo.publication_cleaned(&value.id, self.clock.now()?))?;
                Ok(true)
            })();
            match result {
                Ok(true) => completed += 1,
                Ok(false) => {}
                Err(error) => {
                    if error.code != ErrorCode::Conflict {
                        failure = Some(error);
                    }
                }
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(completed),
        }
    }
}
