use crossfire_adapter_codex::{context_migration, context_state};
use crossfire_adapter_filesystem::PrivateDirectory;
use std::os::unix::fs::symlink;
const SESSION: &str = "00000000-0000-4000-8000-000000000000";
#[test]
fn explicit_conversion_preserves_identity_original_evidence_and_current_runtime_rejection()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let workspace = directory.path().join("work");
    PrivateDirectory::open(&workspace, true)?;
    let home = workspace.join(".codex");
    let private = PrivateDirectory::open(&home, true)?;
    let original = format!("{{\"sessionId\":\"{SESSION}\"}}");
    private.write_new("crossfire-session.json", original.as_bytes())?;
    assert!(
        context_state::load(&home).is_err(),
        "Runtime never guesses an obsolete on-disk representation"
    );
    let migrated = context_migration::run(&workspace, &workspace)?;
    assert!(migrated.migrated);
    assert_eq!(migrated.contexts, 1);
    assert_eq!(
        context_state::load(&home)?.0.bindings[0].session_id,
        SESSION
    );
    let archive = home.join("crossfire-migrations/context-registry/originals");
    assert_eq!(
        std::fs::read(archive.join("crossfire-session.json"))?,
        original.as_bytes()
    );
    assert!(!home.join("crossfire-session.json").exists());
    assert!(
        !context_migration::run(&workspace, &workspace)?.migrated,
        "Completed conversion is an explicit no-op"
    );
    assert_eq!(
        context_state::load(&home)?.0.bindings[0].session_id,
        SESSION
    );
    Ok(())
}
#[test]
fn dangling_homes_and_unknown_original_files_are_not_treated_as_empty()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let workspace = directory.path().join("work");
    PrivateDirectory::open(&workspace, true)?;
    symlink(directory.path().join("missing"), workspace.join(".codex"))?;
    assert!(context_migration::run(&workspace, &workspace).is_err());
    std::fs::remove_file(workspace.join(".codex"))?;
    let home = workspace.join(".codex");
    let private = PrivateDirectory::open(&home, true)?;
    private.write_new(
        "crossfire-session.json",
        format!("{{\"sessionId\":\"{SESSION}\"}}").as_bytes(),
    )?;
    private.write_new("crossfire-session.json.unrecognized", b"retain me")?;
    assert!(context_migration::run(&workspace, &workspace).is_err());
    assert!(home.join("crossfire-session.json").exists());
    assert!(!home.join(context_state::REGISTRY).exists());
    Ok(())
}
