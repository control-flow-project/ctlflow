use crossfire_adapter_filesystem::publication::Store;
use crossfire_domain::publication::{
    port::{BinarySource, PublicationStore},
    values::{File, ManifestFile},
};
use crossfire_kernel::{failure::ErrorCode, identity};
use crossfire_test_support::binary::Bytes;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};

fn file(id: &str, bytes: &[u8]) -> File {
    File {
        id: identity::id(),
        publication_id: id.to_owned(),
        uploaded: false,
        manifest: ManifestFile {
            path: "index.html".to_owned(),
            media_type: "text/html".to_owned(),
            bytes: bytes.len() as i64,
            sha256: identity::hash(std::str::from_utf8(bytes).unwrap_or("")),
        },
    }
}
#[tokio::test]
async fn streamed_upload_is_private_atomic_bounded_hashed_and_exclusive()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let root = fixture.path().join("reports");
    let store = Store::open(&root, 1)?;
    assert!(
        Store::open(&root, 1).is_err(),
        "Real ownership lock excludes another store"
    );
    let id = identity::id();
    let file = file(&id, b"<html>report</html>");
    let guard = store.exclusive(&id)?;
    assert_eq!(
        store.exclusive(&id).err().ok_or("Exclusive conflict")?.code,
        ErrorCode::Conflict
    );
    store
        .upload(
            &id,
            &file,
            Bytes::new(vec![b"<html>".to_vec(), b"report</html>".to_vec()])?,
        )
        .await?;
    assert_eq!(
        fs::metadata(root.join(&id).join(&file.id))?
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    store.verify(&id, std::slice::from_ref(&file)).await?;
    let mut reader = store.read(&id, &file)?;
    assert_eq!(
        reader.next().await?.ok_or("Read chunk")?,
        b"<html>report</html>"
    );
    assert!(reader.next().await?.is_none());
    let invalid = Bytes::new(vec![b"<html>broken</html>".to_vec()])?;
    assert!(store.upload(&id, &file, invalid).await.is_err());
    assert_eq!(
        fs::read(root.join(&id).join(&file.id))?,
        b"<html>report</html>"
    );
    assert_eq!(
        fs::read_dir(root.join(&id))?.count(),
        1,
        "No abandoned partial upload"
    );
    drop(guard);
    assert!(store.exclusive(&id).is_ok());
    store.remove(&id)?;
    store.remove(&id)?;
    assert!(!root.join(&id).exists());
    Ok(())
}
#[tokio::test]
async fn symlink_hardlink_fifo_tampering_and_close_never_publish_or_read_outside_the_store()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let root = fixture.path().join("reports");
    let store = Store::open(&root, 1)?;
    let id = identity::id();
    let file = file(&id, b"data");
    let external = fixture.path().join("untouched");
    fs::write(&external, b"data")?;
    symlink(fixture.path(), root.join(&id))?;
    assert!(
        store
            .upload(&id, &file, Bytes::new(vec![b"data".to_vec()])?)
            .await
            .is_err()
    );
    fs::remove_file(root.join(&id))?;
    store
        .upload(&id, &file, Bytes::new(vec![b"data".to_vec()])?)
        .await?;
    let path = root.join(&id).join(&file.id);
    fs::remove_file(&path)?;
    symlink(&external, &path)?;
    assert!(store.read(&id, &file).is_err());
    assert!(store.remove(&id).is_err());
    fs::remove_file(&path)?;
    fs::hard_link(&external, &path)?;
    assert!(store.read(&id, &file).is_err());
    fs::remove_file(&path)?;
    rustix::fs::mknodat(
        rustix::fs::CWD,
        &path,
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::from_raw_mode(0o600),
        0,
    )?;
    assert!(
        store.read(&id, &file).is_err(),
        "FIFO rejection cannot wait for a writer"
    );
    fs::remove_file(&path)?;
    store
        .upload(&id, &file, Bytes::new(vec![b"data".to_vec()])?)
        .await?;
    fs::write(&path, b"evil")?;
    assert_eq!(
        store
            .verify(&id, std::slice::from_ref(&file))
            .await
            .err()
            .ok_or("Digest conflict")?
            .code,
        ErrorCode::Conflict
    );
    let mut reader = store.read(&id, &file)?;
    store.close();
    assert!(reader.next().await.is_err());
    assert!(store.exclusive(&id).is_err());
    assert_eq!(fs::read(&external)?, b"data");
    Ok(())
}
#[tokio::test]
async fn blocked_uploads_cancel_on_store_close_and_release_capacity_and_pending_files()
-> Result<(), Box<dyn std::error::Error>> {
    struct Blocked {
        notified: tokio::sync::mpsc::Sender<()>,
    }
    impl BinarySource for Blocked {
        fn length(&self) -> i64 {
            4
        }
        async fn next(&mut self) -> crossfire_kernel::Result<Option<Vec<u8>>> {
            let _sent = self.notified.send(()).await;
            std::future::pending().await
        }
    }
    let fixture = tempfile::tempdir()?;
    let root = fixture.path().join("reports");
    let store = Store::open(&root, 1)?;
    let id = identity::id();
    let file = file(&id, b"data");
    let (sent, mut received) = tokio::sync::mpsc::channel(1);
    let first = store.upload(&id, &file, Blocked { notified: sent });
    let cancellation = async {
        received.recv().await.ok_or("Upload started")?;
        assert_eq!(
            store
                .upload(&identity::id(), &file, Bytes::new(vec![b"data".to_vec()])?)
                .await
                .err()
                .ok_or("Busy upload")?
                .code,
            ErrorCode::RateLimit
        );
        store.close();
        Ok::<(), Box<dyn std::error::Error>>(())
    };
    let (result, cancelled) = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        tokio::join!(first, cancellation)
    })
    .await?;
    cancelled?;
    assert!(result.is_err());
    assert_eq!(
        fs::read_dir(root.join(&id))?.count(),
        0,
        "Cancellation removes unpublished bytes"
    );
    Ok(())
}
