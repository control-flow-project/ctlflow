use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_toml::{self as configuration, Table, Value};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const MODEL_KEYS: &[&str] = &[
    "model",
    "model_provider",
    "model_reasoning_effort",
    "model_reasoning_summary",
    "model_verbosity",
    "model_context_window",
    "model_auto_compact_token_limit",
    "model_auto_compact_token_limit_scope",
    "model_supports_reasoning_summaries",
    "model_catalog_json",
    "openai_base_url",
    "chatgpt_base_url",
];

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

pub fn read(home: &Path) -> Result<Table> {
    let Some(file) = OwnedFile::open(
        &home.join("config.toml"),
        configuration::MAXIMUM_BYTES as u64,
    )?
    else {
        return Ok(Table::new());
    };
    file.configuration_permissions()?;
    let information = file.information()?;
    let bytes = Zeroizing::new(file.read_at(information.size as usize, 0)?);
    if file.information()? != information {
        return Err(invalid(
            "Native configuration changed during its bounded read",
        ));
    }
    configuration::parse(&bytes)
}

fn defaults(values: &Table) -> Table {
    MODEL_KEYS
        .iter()
        .filter_map(|key| {
            values
                .get(*key)
                .map(|value| ((*key).to_owned(), value.clone()))
        })
        .collect()
}

pub struct Provider<'a> {
    pub id: &'a str,
    pub settings: Option<&'a Table>,
}

pub fn provider(configuration: &Table) -> Result<Provider<'_>> {
    let profile = configuration
        .get("profile")
        .and_then(Value::as_str)
        .and_then(|name| {
            configuration
                .get("profiles")
                .and_then(Value::as_table)
                .and_then(|profiles| profiles.get(name))
                .and_then(Value::as_table)
        });
    let selected = |key| {
        profile
            .and_then(|profile| profile.get(key))
            .or_else(|| configuration.get(key))
    };
    let id = match selected("model_provider") {
        None => "openai",
        Some(Value::String(value)) if !value.is_empty() => value,
        _ => {
            return Err(invalid(
                "The native model provider must have an exact configured identity",
            ));
        }
    };
    let settings = selected("model_providers")
        .and_then(Value::as_table)
        .and_then(|providers| providers.get(id))
        .and_then(Value::as_table);
    if !["openai", "ollama", "lmstudio"].contains(&id) && settings.is_none() {
        return Err(invalid(
            "The selected native model provider has no configured definition",
        ));
    }
    Ok(Provider { id, settings })
}

pub fn prepare(state: &Path, source: &Path) -> Result<PathBuf> {
    PrivateDirectory::open(state, false)?;
    let path = state.join(".codex");
    let home = PrivateDirectory::open(&path, true)?;
    if home
        .read_optional("config.toml", configuration::MAXIMUM_BYTES as u64)?
        .is_some()
    {
        return Ok(path);
    }
    let original = read(source)?;
    let mut selected = defaults(&original);
    for key in ["model_providers", "cli_auth_credentials_store"] {
        if let Some(value) = original.get(key) {
            selected.insert(key.to_owned(), value.clone());
        }
    }
    if let Some(profile) = original.get("profile") {
        let profile = profile
            .as_str()
            .ok_or_else(|| invalid("The selected native configuration profile is not defined"))?;
        let values = original
            .get("profiles")
            .and_then(Value::as_table)
            .and_then(|profiles| profiles.get(profile))
            .and_then(Value::as_table)
            .ok_or_else(|| invalid("The selected native configuration profile is not defined"))?;
        selected.insert("profile".to_owned(), Value::String(profile.to_owned()));
        selected.insert(
            "profiles".to_owned(),
            Value::Table(Table::from_iter([(
                profile.to_owned(),
                Value::Table(defaults(values)),
            )])),
        );
    }
    provider(&selected)?;
    let bytes = Zeroizing::new(configuration::format(&selected)?);
    home.write_new("config.toml", bytes.as_bytes())?;
    Ok(path)
}

pub fn refresh_authentication(home: &Path, source: &Path) -> Result<()> {
    PrivateDirectory::open(home, false)?;
    if std::fs::canonicalize(source).is_ok_and(|path| path.as_os_str() == home.as_os_str()) {
        return Err(invalid(
            "The host login home must be separate from the managed native home",
        ));
    }
    let operation = || {
        let directory = PrivateDirectory::open(home, false)?;
        let existing = directory.read_optional("auth.json", 65_536)?;
        drop(Zeroizing::new(existing.unwrap_or_default()));
        let path = source.join("auth.json");
        let Some(file) = OwnedFile::open(&path, 65_536)? else {
            if directory.read_optional("auth.json", 65_536)?.is_some() {
                directory.remove("auth.json")?;
            }
            return Ok(());
        };
        file.private_permissions()?;
        let original = file.information()?;
        let bytes = Zeroizing::new(file.read_at(original.size as usize, 0)?);
        if !serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|_| invalid("Invalid native login"))?
            .is_object()
        {
            return Err(invalid("Invalid native login"));
        }
        if file.information()? != original {
            return Err(invalid("Native login changed during its bounded read"));
        }
        directory.write_atomic("auth.json", &bytes)
    };
    operation().map_err(|_: Failure| Failure::new(ErrorCode::Unauthorized, "Cannot refresh the private native Codex login from the host. Check the host CODEX_HOME and sign in with codex login, then resume. Never paste credentials into chat."))
}
