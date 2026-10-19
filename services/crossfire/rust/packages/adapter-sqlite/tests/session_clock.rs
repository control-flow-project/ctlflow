mod support;

use crossfire_adapter_sqlite::store::SharedStore;
use crossfire_domain::{
    port::{AuthorizationRepository, BackendUserIdentity, ListenerRepository, RepositoryAccess},
    session,
};
use crossfire_kernel::{Result, identity, secret::Secret};
use std::sync::atomic::{AtomicI64, Ordering};
use support::{NOW, Scenario};

struct Matrix {
    now: AtomicI64,
}

impl BackendUserIdentity for Matrix {
    async fn identify(&self, _token: &Secret) -> Result<String> {
        self.now.store(NOW + 60_000, Ordering::SeqCst);
        Ok("@owner:example.test".to_owned())
    }
}

#[tokio::test]
async fn management_session_time_is_read_after_native_authentication_finishes()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let matrix = Matrix {
        now: AtomicI64::new(NOW),
    };
    let native_token = Secret::new("native-token".to_owned());
    let mut database = scenario.database()?;
    let repository = SharedStore::new(scenario.store);
    let opened = session::create(&repository, &matrix, &native_token, || {
        Ok(matrix.now.load(Ordering::SeqCst))
    })
    .await?;
    let stored = repository
        .with(|store| store.session(&identity::hash(opened.secret.expose())))?
        .ok_or("Missing session")?;
    assert_eq!(stored.created_at, NOW + 60_000);
    assert_eq!(stored.expires_at, NOW + 60_000 + 8 * 60 * 60 * 1000);
    assert_eq!(opened.member.principal.id, scenario.owner.principal_id);
    assert!(
        repository
            .with(|store| store.principal(&scenario.agent.principal_id))?
            .is_some()
    );
    assert!(
        repository
            .with(|store| store.principal(&guest.principal_id))?
            .is_some()
    );
    let run = repository
        .with(|store| store.listener_run(&scenario.report.run_id))?
        .ok_or("Missing unchanged listener")?;
    assert_eq!(run.last_seen_at, NOW);
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        crossfire_adapter_sqlite::schema::SCHEMA_VERSION
    );
    Ok(())
}
