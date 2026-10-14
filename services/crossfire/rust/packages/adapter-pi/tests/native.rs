use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_pi::{
    admission, options,
    protocol::{Events, Launch, Protocol, Rpc},
    state,
};
use crossfire_adapter_runtime::{history, journal};
use crossfire_kernel::Result;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Notices(Mutex<Vec<Value>>);
impl Events for Notices {
    fn event(&self, value: Value) -> Result<()> {
        if let Ok(mut events) = self.0.lock() {
            events.push(value);
        }
        Ok(())
    }
}

#[tokio::test]
async fn actual_verified_pi_native_rpc_controls_instructions_admission_and_exact_history_resumption_without_inference()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state_directory = directory.path().join("state");
    let home = state_directory.join(".pi");
    PrivateDirectory::open(&state_directory, true)?;
    PrivateDirectory::open(&home, true)?;
    let models = json!({"providers":{"fixture":{"baseUrl":"http://127.0.0.1:1/v1","api":"openai-completions","apiKey":"inert-fixture-only","models":[{"id":"fixture-model","name":"Inert Pi fixture","reasoning":true,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":128000,"maxTokens":8192}]}}});
    PrivateDirectory::open(&home, false)?
        .write_new("models.json", &serde_json::to_vec(&models)?)?;
    let mut binding = state::allocate("shared")?;
    state::initialize(&home, &mut binding, directory.path())?;
    let history_file = state::history(&home, &binding);
    let instructions =
        "Local native Pi acceptance only. No model work, tools or external actions are authorized.";
    let binary = std::env::var_os("CROSSFIRE_TEST_PI_BINARY")
        .ok_or("Prepare the verified native Pi asset once before Rust test workers")?;
    let launch = Launch {
        binary: &binary,
        workspace: directory.path(),
        state: &state_directory,
        home: &home,
        profile: "rust-native-acceptance",
        history: &history_file,
        instructions,
    };
    let events = Arc::new(Notices::default());
    let native = Rpc::start(&launch, Arc::clone(&events), CancellationToken::new()).await?;
    let selected = admission::admit(
        &native,
        &options::parse(
            &json!({"provider":"fixture","model":"fixture-model","thinking_level":"high"}),
        )?,
        CancellationToken::new(),
    )
    .await?;
    let id = selected
        .state
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or("Pi native session")?
        .to_owned();
    assert_eq!(
        selected.state["sessionFile"].as_str(),
        history_file.to_str()
    );
    state::verify(&history_file, directory.path(), &id)?;
    let boundary = history::capture(&history_file)?;
    let digest = journal::digest(instructions);
    let applied = native
        .control(
            "instructions",
            &json!({"text":instructions,"digest":digest}),
            CancellationToken::new(),
        )
        .await?;
    state::verify_instructions(
        &history_file,
        &digest,
        instructions,
        boundary.as_ref(),
        applied
            .get("entryId")
            .and_then(Value::as_str)
            .ok_or("Instruction receipt")?,
    )?;
    let current = native
        .control("state", &json!({}), CancellationToken::new())
        .await?;
    assert_eq!(current["sessionId"], id);
    assert_eq!(current["idle"], true);
    assert_eq!(current["turn"], Value::Null);
    native.close().await?;
    native.close().await?;
    let restarted = Rpc::start(&launch, events, CancellationToken::new()).await?;
    let selected = admission::admit(
        &restarted,
        &options::parse(
            &json!({"provider":"fixture","model":"fixture-model","thinking_level":"high"}),
        )?,
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(selected.state["sessionId"], id);
    state::verify(&history_file, directory.path(), &id)?;
    restarted.close().await?;
    Ok(())
}

#[test]
fn pi_native_options_and_version_reject_silent_provider_model_thinking_substitutions()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    options::parse(&json!({"provider":"selected","model":"exact","thinking_level":"max"}))?;
    options::version("1.0.0")?;
    for input in [
        json!({"provider":"alone"}),
        json!({"model":"alone"}),
        json!({"thinking_level":"auto"}),
        json!({"legacy":true}),
        json!({"model":null}),
    ] {
        assert!(options::parse(&input).is_err());
    }
    for version in ["0.62.0", "1.0.1", "pi 1.0.0", "1.0.0-preview"] {
        assert!(options::version(version).is_err());
    }
    assert!(!options::error_text("\0\u{7f}unsafe").contains('\0'));
    assert!(options::error_text(&"😀".repeat(2000)).len() <= 4000);
    Ok(())
}
