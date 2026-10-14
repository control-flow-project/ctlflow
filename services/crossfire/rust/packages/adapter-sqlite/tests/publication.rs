mod support;
use crossfire_adapter_filesystem::publication::Store as Files;
use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_domain::{
    identity::Status,
    port::{AuthorizationRepository, CoreRepository, RepositoryAccess, UnitOfWork},
    publication::{
        port::{BinarySource, PublicationRepository},
        read,
        service::Service,
        values::*,
    },
};
use crossfire_kernel::{Result, failure::ErrorCode, identity};
use crossfire_test_support::binary::Bytes;
use diesel::RunQueryDsl;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use support::{NOW, Scenario};

fn creation() -> Creation {
    Creation {
        title: "Static analysis".to_owned(),
        files: vec![ManifestFile {
            path: "index.html".to_owned(),
            media_type: "text/html".to_owned(),
            bytes: 4,
            sha256: identity::hash("data"),
        }],
    }
}
#[tokio::test]
async fn report_create_upload_commit_list_read_delete_is_generation_authorized_and_uses_prepared_schema()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    assert!(scenario.report.controller.connection_id.len() == 36);
    let mut metadata = scenario.database()?;
    let shared = SharedStore::new(scenario.store);
    let fixture = tempfile::tempdir()?;
    let files = Files::open(&fixture.path().join("reports"), 8)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &shared,
        storage: &files,
        clock: &clock,
        origin: "https://content.example.test",
        budget: Budget::default(),
    };
    assert!(
        service
            .create(&scenario.owner, &creation(), "request")
            .is_err()
    );
    let draft = service.create(&scenario.agent, &creation(), "request")?;
    let id = &draft.summary.id;
    assert_eq!(
        shared
            .with(|repo| read::details(repo, "https://content.example.test", &guest, id, NOW))
            .err()
            .ok_or("Other owner privacy")?
            .code,
        ErrorCode::Missing
    );
    assert!(draft.summary.url.is_none());
    assert!(
        service
            .commit(&scenario.agent, id, 0, "request")
            .await
            .is_err()
    );
    service
        .upload(
            &scenario.agent,
            id,
            &draft.files[0].id,
            Bytes::new(vec![b"da".to_vec(), b"ta".to_vec()])?,
        )
        .await?;
    let published = service.commit(&scenario.agent, id, 0, "request").await?;
    assert_eq!(published.summary.state, State::Published);
    assert_eq!(
        service
            .commit(&scenario.agent, id, 0, "request")
            .await?
            .summary
            .revision,
        1
    );
    let record = shared
        .with(|repo| repo.publication(id))?
        .ok_or("Stored publication")?;
    assert_eq!(record.publication.public_key.len(), 43);
    assert_eq!(
        published.summary.url,
        Some(format!(
            "https://content.example.test/{}/index.html",
            record.publication.public_key
        ))
    );
    let wire = crossfire_contracts::publication::details(&published);
    assert!(wire.get("publicKey").is_none() && wire.get("cleanedAt").is_none());
    assert!(wire["files"][0].get("publicationId").is_none());
    let page = shared.with(|repo| {
        read::page(
            repo,
            "https://content.example.test",
            &scenario.owner,
            &Query {
                page: 1,
                page_size: 20,
                search: "Static".to_owned(),
                owner_id: None,
                agent_id: None,
                state: None,
            },
            NOW,
        )
    })?;
    assert_eq!(page.total_items, 1);
    assert_eq!(page.items[0].allowed_actions, vec!["delete"]);
    assert!(
        shared
            .with(|repo| repo.public_file(&record.publication.public_key, "index.html"))?
            .is_some()
    );
    assert!(service.delete(&scenario.agent, id, 1, "request").is_err());
    assert!(service.delete(&scenario.owner, id, 0, "request").is_err());
    service.delete(&scenario.owner, id, 1, "request")?;
    service.delete(&scenario.owner, id, 1, "request")?;
    assert!(
        shared
            .with(|repo| repo.public_file(&record.publication.public_key, "index.html"))?
            .is_none()
    );
    assert_eq!(
        shared.with(|repo| repo.publication_usage(&scenario.agent.principal_id))?,
        Usage::default()
    );
    assert_eq!(
        shared.with(|repo| repo.schema_identity())?,
        (1_129_465_426, 17)
    );
    let count: i64 = diesel::QueryDsl::count(crossfire_adapter_sqlite::tables::publication::table)
        .get_result(metadata.connection())?;
    assert_eq!(
        count, 1,
        "Deletion retains fenced metadata, not an application reset"
    );
    Ok(())
}
#[tokio::test]
async fn revocation_during_streaming_rechecks_authority_without_holding_the_repository_lock_across_io()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    struct Revoke {
        bytes: Bytes,
        repository: Arc<SharedStore>,
        owner: String,
    }
    impl BinarySource for Revoke {
        fn length(&self) -> i64 {
            self.bytes.length()
        }
        async fn next(&mut self) -> Result<Option<Vec<u8>>> {
            let bytes = self.bytes.next().await?;
            if bytes.is_none() {
                self.repository.with(|repo| {
                    let mut owner = repo.principal(&self.owner)?.ok_or_else(|| {
                        crossfire_kernel::Failure::new(ErrorCode::Missing, "Owner")
                    })?;
                    owner.status = Status::Suspended;
                    owner.revision += 1;
                    repo.save_principal(&owner)
                })?;
            }
            Ok(bytes)
        }
    }
    let scenario = Scenario::create()?;
    let shared = Arc::new(SharedStore::new(scenario.store));
    let fixture = tempfile::tempdir()?;
    let files = Files::open(&fixture.path().join("reports"), 8)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: shared.as_ref(),
        storage: &files,
        clock: &clock,
        origin: "https://content.example.test",
        budget: Budget::default(),
    };
    let draft = service.create(&scenario.agent, &creation(), "request")?;
    let input = Revoke {
        bytes: Bytes::new(vec![b"data".to_vec()])?,
        repository: Arc::clone(&shared),
        owner: scenario.owner.principal_id.clone(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        service.upload(
            &scenario.agent,
            &draft.summary.id,
            &draft.files[0].id,
            input,
        ),
    )
    .await?;
    assert_eq!(
        result.err().ok_or("Revoked publisher")?.code,
        ErrorCode::Forbidden
    );
    assert!(!shared.with(|repo| repo.publication_files(&draft.summary.id))?[0].uploaded);
    assert!(
        service
            .commit(&scenario.agent, &draft.summary.id, 0, "request")
            .await
            .is_err()
    );
    Ok(())
}
#[tokio::test]
async fn capacity_counts_unreclaimed_staging_and_expiration_maintenance_reclaims_it_without_reading_public_reports()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let scenario = Scenario::create()?;
    let shared = SharedStore::new(scenario.store);
    let fixture = tempfile::tempdir()?;
    let files = Files::open(&fixture.path().join("reports"), 8)?;
    let now = AtomicI64::new(NOW);
    let clock = || Ok(now.load(Ordering::Acquire));
    let service = Service {
        repository: &shared,
        storage: &files,
        clock: &clock,
        origin: "https://content.example.test",
        budget: Budget {
            instance_count: 1,
            ..Budget::default()
        },
    };
    let draft = service.create(&scenario.agent, &creation(), "request")?;
    assert_eq!(
        service
            .create(&scenario.agent, &creation(), "request")
            .err()
            .ok_or("Capacity failure")?
            .code,
        ErrorCode::Capacity
    );
    service
        .upload(
            &scenario.agent,
            &draft.summary.id,
            &draft.files[0].id,
            Bytes::new(vec![b"data".to_vec()])?,
        )
        .await?;
    assert_eq!(service.maintain()?, 0);
    now.store(NOW + STAGING_MS, Ordering::Release);
    assert_eq!(service.maintain()?, 1);
    assert_eq!(service.maintain()?, 0);
    assert_eq!(
        shared.with(|repo| repo.publication_usage(&scenario.agent.principal_id))?,
        Usage::default()
    );
    Ok(())
}
#[tokio::test]
async fn deletion_fences_public_reads_before_cleanup_can_acquire_the_upload_lock()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    use crossfire_domain::publication::port::PublicationStore;
    let scenario = Scenario::create()?;
    let shared = SharedStore::new(scenario.store);
    let fixture = tempfile::tempdir()?;
    let root = fixture.path().join("reports");
    let files = Files::open(&root, 8)?;
    let clock = || Ok(NOW);
    let service = Service {
        repository: &shared,
        storage: &files,
        clock: &clock,
        origin: "https://content.example.test",
        budget: Budget::default(),
    };
    let draft = service.create(&scenario.agent, &creation(), "request")?;
    let id = &draft.summary.id;
    service
        .upload(
            &scenario.agent,
            id,
            &draft.files[0].id,
            Bytes::new(vec![b"data".to_vec()])?,
        )
        .await?;
    service.commit(&scenario.agent, id, 0, "request").await?;
    let record = shared
        .with(|repo| repo.publication(id))?
        .ok_or("Published")?;
    let guard = files.exclusive(id)?;
    service.delete(&scenario.owner, id, 1, "request")?;
    assert!(
        shared
            .with(|repo| repo.public_file(&record.publication.public_key, "index.html"))?
            .is_none()
    );
    assert_eq!(
        shared
            .with(|repo| repo.publication_usage(&scenario.agent.principal_id))?
            .instance_count,
        1
    );
    assert!(root.join(id).exists());
    drop(guard);
    assert_eq!(service.maintain()?, 1);
    assert!(!root.join(id).exists());
    let before = shared.with(|repo| repo.publication_usage(&scenario.agent.principal_id))?;
    let mut invalid = record.publication;
    invalid.id = identity::id();
    invalid.public_key = identity::secret()?.expose().to_owned();
    invalid.state = State::Staging;
    let mut bad_file = draft.files[0].clone();
    bad_file.publication_id = "no-parent".to_owned();
    assert!(
        shared
            .with(|repo| repo.transaction(|repo| repo.insert_publication(&invalid, &[bad_file])))
            .is_err()
    );
    assert_eq!(
        shared.with(|repo| repo.publication_usage(&scenario.agent.principal_id))?,
        before,
        "Expected write failures roll back the entire manifest"
    );
    Ok(())
}
