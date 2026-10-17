use fleetd_storage::authentication;
use serde::Deserialize;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
};

#[derive(Deserialize)]
struct Cases {
    valid: Vec<Valid>,
    invalid: Vec<String>,
}
#[derive(Deserialize)]
struct Valid {
    text: String,
    key: Option<String>,
    label: String,
}
fn cases() -> Result<Cases, serde_json::Error> {
    serde_json::from_str(include_str!(
        "../../../../tests/contracts/authentication-cases.json"
    ))
}

#[test]
fn native_configuration_directories_are_explicit_and_normalized()
-> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        authentication::configuration_directory("linux", Path::new("/home/operator"), None)?,
        Path::new("/home/operator/.config/ctlflow")
    );
    assert_eq!(
        authentication::configuration_directory(
            "linux",
            Path::new("/home/operator"),
            Some(Path::new("/private/config"))
        )?,
        Path::new("/private/config/ctlflow")
    );
    assert_eq!(
        authentication::configuration_directory(
            "darwin",
            Path::new("/Users/operator"),
            Some(Path::new("/ignored"))
        )?,
        Path::new("/Users/operator/Library/Application Support/ctlflow")
    );
    for (platform, home, xdg) in [
        ("linux", "/home/operator/", None),
        ("linux", "/home/operator", Some("/private/config/")),
        ("windows", "/home/operator", None),
        ("linux", "relative", None),
        ("linux", "/home/operator/../other", None),
        ("linux", "/home/operator", Some("")),
        ("linux", "/home/operator", Some("relative")),
        ("linux", "/home/operator", Some("/private/../other")),
        ("linux", "/home/operator", Some("/private/./other")),
        ("linux", "/home/operator", Some("/private//other")),
    ] {
        assert!(
            authentication::configuration_directory(platform, Path::new(home), xdg.map(Path::new))
                .is_err()
        );
    }
    Ok(())
}

#[test]
fn configuration_decoding_uses_the_common_cases_without_secret_diagnostics()
-> Result<(), Box<dyn std::error::Error>> {
    let cases = cases()?;
    for case in cases.valid {
        let actual = authentication::decode(case.text.as_bytes())?;
        assert_eq!(
            actual.as_ref().map(|key| key.expose()),
            case.key.as_deref(),
            "{}",
            case.label
        );
    }
    for case in cases.invalid {
        let error = authentication::decode(case.as_bytes())
            .err()
            .ok_or("Invalid configuration was accepted")?;
        assert!(!error.message.contains("do-not-leak-secret"));
    }
    assert!(authentication::decode(&[0xc3, 0x28]).is_err());
    assert!(authentication::decode(&vec![b' '; 4097]).is_err());
    Ok(())
}

#[tokio::test]
async fn initialization_is_private_persistent_and_serialized()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let file = directory.path().join("ctlflow/fleetd.json");
    assert!(authentication::read(&file).is_err());
    assert!(!file.parent().ok_or("Fixture parent missing")?.exists());
    let key = authentication::initialize(&file).await?;
    assert_eq!(key.expose().len(), 64);
    assert_eq!(fs::metadata(&file)?.permissions().mode() & 0o777, 0o600);
    assert_eq!(
        fs::metadata(file.parent().ok_or("Fixture parent missing")?)?
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let modified = fs::metadata(&file)?.modified()?;
    assert_eq!(authentication::initialize(&file).await?, key);
    assert_eq!(authentication::read(&file)?, key);
    assert_eq!(fs::metadata(&file)?.modified()?, modified);
    assert_ne!(
        authentication::initialize(&directory.path().join("other/fleetd.json")).await?,
        key
    );
    let mut tasks = Vec::new();
    let concurrent = directory.path().join("concurrent/fleetd.json");
    for _index in 0..8 {
        let path = concurrent.clone();
        tasks.push(tokio::spawn(async move {
            authentication::initialize(&path).await
        }));
    }
    let mut keys = Vec::new();
    for task in tasks {
        keys.push(task.await??);
    }
    assert!(keys.iter().all(|key| key == &keys[0]));
    assert!(authentication::matches(
        Some(&format!("Bearer {}", key.expose())),
        &key
    ));
    for header in [None, Some(""), Some("Bearer guessed"), Some(key.expose())] {
        assert!(!authentication::matches(header, &key));
    }
    Ok(())
}

#[tokio::test]
async fn keyless_valid_configuration_is_completed_but_invalid_or_unsafe_state_is_never_replaced()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let file = directory.path().join("fleetd.json");
    fs::write(&file, b"{\"schemaVersion\":1}")?;
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600))?;
    assert!(authentication::read(&file).is_err());
    let key = authentication::initialize(&file).await?;
    let content = fs::read(&file)?;
    for invalid in cases()?.invalid {
        let bytes = invalid.as_bytes();
        fs::write(&file, bytes)?;
        assert!(authentication::initialize(&file).await.is_err());
        assert_eq!(fs::read(&file)?, bytes);
    }
    fs::write(&file, &content)?;
    fs::set_permissions(&file, fs::Permissions::from_mode(0o644))?;
    assert!(authentication::initialize(&file).await.is_err());
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600))?;
    let linked = directory.path().join("linked.json");
    fs::hard_link(&file, &linked)?;
    assert!(authentication::read(&file).is_err());
    fs::remove_file(&linked)?;
    assert_eq!(authentication::read(&file)?, key);
    fs::remove_file(&file)?;
    fs::write(&linked, &content)?;
    symlink(&linked, &file)?;
    assert!(authentication::initialize(&file).await.is_err());
    fs::remove_file(&file)?;
    symlink(directory.path().join("absent"), &file)?;
    assert!(authentication::initialize(&file).await.is_err());
    Ok(())
}
