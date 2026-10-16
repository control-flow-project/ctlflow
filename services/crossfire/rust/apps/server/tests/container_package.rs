use crossfire_server::{container_package as package, operator};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    process::Command,
};
use tokio_util::sync::CancellationToken;

fn manifest() -> Value {
    json!({"schemaVersion":1,"version":"0.1.20","sourceDigest":"a".repeat(64),"backend":"rust","platform":"linux/amd64","archiveSha256":format!("{:x}",Sha256::digest(b"fixture archive")),"runtimeImage":format!("sha256:{}","b".repeat(64)),"migrationImage":format!("sha256:{}","c".repeat(64))})
}
#[test]
fn exact_backend_independent_manifest_rejects_alternate_identities()
-> Result<(), Box<dyn std::error::Error>> {
    let original = manifest();
    for backend in ["node", "csharp-managed", "csharp-nativeaot", "rust"] {
        let mut value = original.clone();
        value["backend"] = backend.into();
        let parsed = package::parse(&value)?;
        assert_eq!(parsed.backend, backend);
        assert_eq!(
            package::labels(&parsed, backend)["org.crossfire.source"],
            "a".repeat(64)
        );
        assert_eq!(serde_json::to_value(parsed)?, value);
    }
    for (key, value) in [
        ("schemaVersion", json!(2)),
        ("platform", json!("linux/arm64")),
        ("backend", json!("migrations")),
        ("backend", json!("../node")),
        ("backend", json!("")),
        ("version", json!("1.2")),
        ("version", json!("1.2.3+build")),
        ("version", json!("1.2.3-")),
        ("version", json!("")),
        ("sourceDigest", json!("A".repeat(64))),
        ("archiveSha256", Value::Null),
        ("runtimeImage", json!("mutable:latest")),
        ("migrationImage", original["runtimeImage"].clone()),
        ("extra", json!(true)),
    ] {
        let mut changed = original.clone();
        changed[key] = value;
        assert!(package::parse(&changed).is_err(), "invalid field {key}");
    }
    for key in original.as_object().ok_or("manifest object")?.keys() {
        let mut changed = original.clone();
        changed
            .as_object_mut()
            .ok_or("manifest object")?
            .remove(key);
        assert!(package::parse(&changed).is_err(), "missing field {key}");
    }
    let mut numeric = original.clone();
    numeric["schemaVersion"] = json!(1.0);
    assert!(package::parse(&numeric).is_ok());
    Ok(())
}
#[tokio::test]
async fn bounds_corruption_symlinks_and_cancellation_fail_before_docker()
-> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    let root = temporary.path();
    std::fs::write(root.join("release.json"), serde_json::to_vec(&manifest())?)?;
    std::fs::write(root.join("images.tar"), "corrupt archive")?;
    assert!(
        package::prepare(root, root, CancellationToken::new())
            .await
            .is_err_and(|error| error.message.contains("SHA-256"))
    );
    std::fs::remove_file(root.join("images.tar"))?;
    std::fs::write(root.join("original"), "fixture archive")?;
    symlink(root.join("original"), root.join("images.tar"))?;
    assert!(
        package::prepare(root, root, CancellationToken::new())
            .await
            .is_err()
    );
    std::fs::remove_file(root.join("images.tar"))?;
    let file = std::fs::File::create(root.join("images.tar"))?;
    file.set_len(17_179_869_185)?;
    assert!(
        package::prepare(root, root, CancellationToken::new())
            .await
            .is_err()
    );
    std::fs::write(root.join("images.tar"), "fixture archive")?;
    let stop = CancellationToken::new();
    stop.cancel();
    assert!(
        package::prepare(root, root, stop)
            .await
            .is_err_and(|error| error.message.contains("cancelled"))
    );
    std::fs::write(root.join("release.json"), " ".repeat(8193))?;
    assert!(
        package::prepare(root, root, CancellationToken::new())
            .await
            .is_err()
    );
    for option in ["--source", "--compile", "--runtime"] {
        assert!(
            operator::run(
                &["start".into(), option.into(), "obsolete".into()],
                CancellationToken::new()
            )
            .await
            .is_err()
        );
    }
    Ok(())
}
fn run(root: &Path, mode: &str) -> Result<std::process::Output, Box<dyn std::error::Error>> {
    let state = root.join("state");
    let result = Command::new(env!("CARGO_BIN_EXE_crossfire"))
        .args(["start", "--directory"])
        .arg(&state)
        .arg("--package")
        .arg(root)
        .env("PATH", format!("{}:/usr/bin:/bin", root.display()))
        .env("FIXTURE_ROOT", root)
        .env("FIXTURE_MODE", mode)
        .output()?;
    Ok(result)
}
#[test]
fn import_and_exact_image_release_validation_precede_any_writer_changes()
-> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    let root = temporary.path();
    let state = root.join("state");
    let initialized = Command::new(env!("CARGO_BIN_EXE_crossfire"))
        .args(["init", "--directory"])
        .arg(&state)
        .args([
            "--instance",
            "test",
            "--origin",
            "http://127.0.0.1:8098",
            "--content-origin",
            "http://localhost:8099",
            "--server-name",
            "test.localhost",
            "--administrator",
            "admin",
        ])
        .output()?;
    assert!(
        initialized.status.success(),
        "private instance initialization"
    );
    std::fs::write(root.join("release.json"), serde_json::to_vec(&manifest())?)?;
    std::fs::write(root.join("images.tar"), "fixture archive")?;
    let runtime = format!("sha256:{}", "b".repeat(64));
    let migration = format!("sha256:{}", "c".repeat(64));
    for (identity, backend, name) in [
        (&runtime, "rust", "runtime.json"),
        (&migration, "migrations", "migration.json"),
    ] {
        std::fs::write(
            root.join(name),
            serde_json::to_vec(
                &json!([{"Id":identity,"Os":"linux","Architecture":"amd64","Config":{"Labels":package::labels(&package::parse(&manifest())?, backend)}}]),
            )?,
        )?;
    }
    std::fs::write(
        root.join("docker"),
        r##"#!/bin/sh
printf '%s\n' "$*" >> "$FIXTURE_ROOT/calls"
case "$1 $2" in
  'info --format') printf '["name=rootless"]\n' ;;
  'image inspect')
    if [ "$FIXTURE_MODE" = missing ] && [ ! -f "$FIXTURE_ROOT/loaded" ]; then exit 1; fi
    case "$3" in
      sha256:bbbb*) /bin/cat "$FIXTURE_ROOT/runtime.json" ;;
      sha256:cccc*) /bin/cat "$FIXTURE_ROOT/migration.json" ;;
      *) exit 1 ;;
    esac ;;
  'load --input') printf loaded > "$FIXTURE_ROOT/loaded" ;;
  'container ls') exit 0 ;;
  'create --name') echo 'fixture prevents migration launch' >&2; exit 1 ;;
  *) echo 'unexpected command' >&2; exit 1 ;;
esac
"##,
    )?;
    std::fs::set_permissions(root.join("docker"), std::fs::Permissions::from_mode(0o700))?;
    let loaded = run(root, "missing")?;
    assert!(!loaded.status.success());
    let calls = std::fs::read_to_string(root.join("calls"))?;
    assert!(calls.contains("load --input"));
    assert!(calls.contains("create --name crossfire-migration-"));
    assert!(String::from_utf8(loaded.stderr)?.contains("Cannot create owned container"));
    for (key, wrong) in [
        ("Id", json!(runtime.clone() + "bad")),
        ("Os", json!("windows")),
        ("Architecture", json!("arm64")),
        ("Config", json!({"Labels":{}})),
    ] {
        let path = root.join("runtime.json");
        let saved = std::fs::read(&path)?;
        let mut value: Value = serde_json::from_slice(&saved)?;
        value[0][key] = wrong;
        std::fs::write(&path, serde_json::to_vec(&value)?)?;
        std::fs::write(root.join("calls"), "")?;
        let rejected = run(root, "present")?;
        assert!(!rejected.status.success());
        assert!(String::from_utf8(rejected.stderr)?.contains("release labels"));
        let calls = std::fs::read_to_string(root.join("calls"))?;
        assert!(
            !calls.contains("container ls")
                && !calls.contains("create ")
                && !calls.contains("stop "),
            "validation must precede touching writers"
        );
        std::fs::write(path, saved)?;
    }
    Ok(())
}
