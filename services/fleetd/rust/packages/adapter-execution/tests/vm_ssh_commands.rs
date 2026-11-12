use crossfire_adapter_process::ssh_commands;
use crossfire_adapter_process::{NativeCommand, capture};
use std::{collections::BTreeMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn guest_command_quoting_environment_and_connection_loss()
-> Result<(), Box<dyn std::error::Error>> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .ok_or("VM tests require the actual private user runtime directory")?;
    let root = tempfile::Builder::new()
        .prefix("cfvm-")
        .tempdir_in(runtime)?;
    let root = root.path();
    let id = crossfire_kernel::identity::id();
    let master = ssh_commands::master(root, &id, Some(31234))?;
    assert!(
        master
            .arguments
            .contains(&format!("SendEnv={}", ssh_commands::PROVIDER_SECRET).into())
    );
    assert!(matches!(
        master
            .environment
            .get(std::ffi::OsStr::new(ssh_commands::PROVIDER_SECRET)),
        Some(None)
    ));
    assert!(
        master
            .arguments
            .contains(&"StrictHostKeyChecking=yes".into())
    );
    assert!(
        master
            .arguments
            .contains(&"127.0.0.1:31234:127.0.0.1:31234".into())
    );
    assert!(
        !ssh_commands::master(root, &id, None)?
            .arguments
            .contains(&"-R".into())
    );
    assert!(ssh_commands::master(root, &id, Some(0)).is_err());
    assert!(ssh_commands::master(Path::new("/tmp/space directory"), &id, None).is_err());
    let workspace = root.join("reader's研究");
    std::fs::create_dir(&workspace)?;
    let argument = "literal ' quote \" and $(touch injected) `touch injected`\nnext";
    let program = "import os,json,sys;print(json.dumps({'cwd':os.getcwd(),'args':sys.argv[1:],'environment':dict(os.environ)}))";
    let placed = ssh_commands::place(
        root,
        &id,
        &NativeCommand {
            binary: "/usr/bin/python3".into(),
            arguments: vec!["-c".into(), program.into(), argument.into()],
            workspace: workspace.clone(),
            input: true,
            environment: BTreeMap::from([
                (
                    "CODEX_HOME".into(),
                    Some(workspace.join(".codex").into_os_string()),
                ),
                ("PATH".into(), Some("/untrusted".into())),
                ("HOST_SECRET".into(), Some("not-authorized".into())),
                ("LD_PRELOAD".into(), Some("/untrusted".into())),
                ("CODEX_THREAD_ID".into(), Some("wrong-context".into())),
                ("CROSSFIRE_AGENT_NAME".into(), Some("analyst's研究".into())),
                (
                    "FLEET_RUNTIME_AUTH_TOKEN".into(),
                    Some("foreign-native-token".into()),
                ),
                ("OPENAI_API_KEY".into(), Some("foreign-provider-key".into())),
            ]),
        },
    )?;
    assert!(placed.input);
    assert!(
        placed
            .arguments
            .contains(&"ProxyCommand=/usr/bin/false".into())
    );
    assert!(placed.arguments.contains(&"ControlMaster=no".into()));
    let output = capture(
        &NativeCommand {
            binary: "/bin/sh".into(),
            arguments: vec![
                "-c".into(),
                placed
                    .arguments
                    .last()
                    .ok_or("Missing remote command")?
                    .clone(),
            ],
            workspace: root.to_owned(),
            input: false,
            environment: BTreeMap::from([("HOST_SECRET".into(), Some("ambient-secret".into()))]),
        },
        32768,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(
        output.status.success(),
        "Shell command admission: {}",
        output.errors
    );
    let value: serde_json::Value = serde_json::from_str(&output.output)?;
    assert_eq!(value["cwd"].as_str(), workspace.to_str());
    assert_eq!(value["args"][0].as_str(), Some(argument));
    assert!(!workspace.join("injected").exists());
    let environment = &value["environment"];
    assert!(
        environment.get("HOST_SECRET").is_none()
            && environment.get("LD_PRELOAD").is_none()
            && environment.get("CODEX_THREAD_ID").is_none()
            && environment.get("FLEET_RUNTIME_AUTH_TOKEN").is_none()
            && environment.get("OPENAI_API_KEY").is_none()
    );
    assert_eq!(environment["PATH"].as_str(), Some(ssh_commands::GUEST_PATH));
    assert_eq!(environment["HOME"].as_str(), Some("/root"));
    assert_eq!(
        environment["CODEX_HOME"].as_str(),
        workspace.join(".codex").to_str()
    );
    let secret = "fixture-key-'\"$(not-a-command)\nsecond-line";
    let native = NativeCommand {
        binary: "/usr/bin/python3".into(),
        arguments: vec!["-c".into(), program.into()],
        workspace: workspace.clone(),
        input: false,
        environment: BTreeMap::from([
            (
                ssh_commands::PROVIDER_KEY.into(),
                Some("SELECTED_PROVIDER_KEY".into()),
            ),
            ("SELECTED_PROVIDER_KEY".into(), Some(secret.into())),
            ("OTHER_PROVIDER_KEY".into(), Some("must-not-cross".into())),
        ]),
    };
    let selected = ssh_commands::place(root, &id, &native)?;
    assert!(
        selected
            .arguments
            .contains(&format!("SendEnv={}", ssh_commands::PROVIDER_SECRET).into())
    );
    assert!(
        !selected
            .arguments
            .iter()
            .any(|argument| argument.to_string_lossy().contains(secret))
    );
    let delivered = capture(
        &NativeCommand {
            binary: "/bin/sh".into(),
            arguments: vec![
                "-c".into(),
                selected
                    .arguments
                    .last()
                    .ok_or("Missing provider command")?
                    .clone(),
            ],
            workspace: root.to_owned(),
            input: false,
            environment: selected.environment,
        },
        32768,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(delivered.status.success());
    let delivered: serde_json::Value = serde_json::from_str(&delivered.output)?;
    assert_eq!(
        delivered["environment"]["SELECTED_PROVIDER_KEY"].as_str(),
        Some(secret)
    );
    assert!(delivered["environment"].get("OTHER_PROVIDER_KEY").is_none());
    assert!(
        delivered["environment"]
            .get(ssh_commands::PROVIDER_SECRET)
            .is_none()
    );
    let mut invalid = native;
    invalid.environment = BTreeMap::from([
        (ssh_commands::PROVIDER_KEY.into(), Some("PATH".into())),
        ("PATH".into(), Some(secret.into())),
    ]);
    assert!(ssh_commands::place(root, &id, &invalid).is_err());
    assert!(
        ssh_commands::forward(root, &id, 31235, 31236)?
            .arguments
            .contains(&"127.0.0.1:31235:127.0.0.1:31236".into())
    );
    assert!(ssh_commands::forward(root, &id, 0, 31236).is_err());
    let absent = capture(
        &ssh_commands::check(root, &id)?,
        8192,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(
        !absent.status.success(),
        "An absent owned multiplex socket must fail closed"
    );
    let marker = root.join("must-not-run-on-host");
    let terminal = ssh_commands::terminal(
        &ssh_commands::SshExecution {
            directory: root.to_owned(),
            id,
        },
        &workspace,
        &format!("/usr/bin/touch '{}'", marker.display()),
    )?;
    let refused = capture(
        &NativeCommand {
            binary: "/bin/sh".into(),
            arguments: vec!["-c".into(), terminal.into()],
            workspace: root.to_owned(),
            environment: BTreeMap::new(),
            input: false,
        },
        8192,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(
        !refused.status.success() && !marker.exists(),
        "A missing guest terminal never executes its command on the host"
    );
    Ok(())
}
