use crossfire_adapter_codex::home;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_toml::{self as configuration, Value};
use std::os::unix::fs::{PermissionsExt, symlink};

#[test]
fn managed_configuration_copies_only_native_model_provider_and_selected_profile_defaults()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("host");
    let state = directory.path().join("state");
    let host = PrivateDirectory::open(&source, true)?;
    PrivateDirectory::open(&state, true)?;
    let original = b"model = 'global'\nprofile = 'work'\nmodel_provider = 'private'\nsandbox_mode = 'danger-full-access'\ncli_auth_credentials_store = 'file'\n[mcp_servers.private]\ncommand = 'do-not-copy'\n[model_providers.private]\nbase_url = 'https://provider.example/v1'\nenv_key = 'PRIVATE_PROVIDER_KEY'\n[profiles.work]\nmodel = 'exact-model'\nmodel_reasoning_effort = 'max'\n[profiles.other]\nmodel = 'not-selected'\n";
    host.write_new("config.toml", original)?;
    let prepared = home::prepare(&state, &source)?;
    let copied = home::read(&prepared)?;
    assert_eq!(copied["model"].as_str(), Some("global"));
    assert_eq!(
        copied["profiles"]["work"]["model"].as_str(),
        Some("exact-model")
    );
    assert!(
        copied["profiles"]
            .as_table()
            .is_some_and(|values| !values.contains_key("other"))
    );
    assert!(!copied.contains_key("mcp_servers"));
    assert!(!copied.contains_key("sandbox_mode"));
    assert_eq!(home::provider(&copied)?.id, "private");
    host.write_atomic("config.toml", b"model = 'changed'\n")?;
    assert_eq!(home::prepare(&state, &source)?, prepared);
    assert_eq!(
        home::read(&prepared)?["model"].as_str(),
        Some("global"),
        "Managed configuration is not silently replaced"
    );
    assert_eq!(
        std::fs::metadata(prepared.join("config.toml"))?
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    Ok(())
}

#[test]
fn malformed_profiles_or_providers_never_create_a_substituted_configuration()
-> Result<(), Box<dyn std::error::Error>> {
    for text in [
        "model_provider = 'missing'\n",
        "profile = 'missing'\n",
        "model_provider = 7\n",
    ] {
        let directory = tempfile::tempdir()?;
        let source = directory.path().join("host");
        let state = directory.path().join("state");
        PrivateDirectory::open(&source, true)?.write_new("config.toml", text.as_bytes())?;
        PrivateDirectory::open(&state, true)?;
        assert!(home::prepare(&state, &source).is_err());
        assert!(!state.join(".codex/config.toml").exists());
    }
    let mut configuration = configuration::parse(
        b"model_provider = 'openai'\n[profiles.work]\nmodel_provider = 'lmstudio'\n",
    )?;
    configuration.insert("profile".to_owned(), Value::String("work".to_owned()));
    assert_eq!(home::provider(&configuration)?.id, "lmstudio");
    Ok(())
}

#[test]
fn authentication_is_replaced_on_every_resume_and_removed_when_host_login_is_removed()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("host");
    let target = directory.path().join("native");
    let host = PrivateDirectory::open(&source, true)?;
    let native = PrivateDirectory::open(&target, true)?;
    host.write_new("auth.json", b"{\"fixture\":\"first\"}")?;
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o755))?;
    home::refresh_authentication(&target, &source)?;
    assert_eq!(native.read("auth.json", 65536)?, b"{\"fixture\":\"first\"}");
    host.write_atomic("auth.json", b"{\"fixture\":\"second\"}")?;
    home::refresh_authentication(&target, &source)?;
    assert_eq!(
        native.read("auth.json", 65536)?,
        b"{\"fixture\":\"second\"}"
    );
    host.remove("auth.json")?;
    home::refresh_authentication(&target, &source)?;
    assert!(native.read_optional("auth.json", 65536)?.is_none());
    assert!(home::refresh_authentication(&target, &target).is_err());
    Ok(())
}

#[test]
fn unsafe_or_corrupt_host_login_preserves_the_previous_native_login_without_leaking_it()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("host");
    let target = directory.path().join("native");
    let host = PrivateDirectory::open(&source, true)?;
    let native = PrivateDirectory::open(&target, true)?;
    native.write_new("auth.json", b"{\"fixture\":\"previous\"}")?;
    host.write_new("auth.json", b"private-secret-invalid-json")?;
    let failure = home::refresh_authentication(&target, &source)
        .err()
        .ok_or("Unsafe login rejected")?;
    assert!(!failure.message.contains("private-secret"));
    assert_eq!(
        native.read("auth.json", 65536)?,
        b"{\"fixture\":\"previous\"}"
    );
    host.remove("auth.json")?;
    let outside = directory.path().join("outside");
    std::fs::write(&outside, b"{\"secret\":\"outside\"}")?;
    symlink(&outside, source.join("auth.json"))?;
    assert!(home::refresh_authentication(&target, &source).is_err());
    assert_eq!(
        native.read("auth.json", 65536)?,
        b"{\"fixture\":\"previous\"}"
    );
    Ok(())
}
