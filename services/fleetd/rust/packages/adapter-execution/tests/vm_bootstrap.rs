use crossfire_adapter_filesystem::owned::OwnedFile;
use crossfire_adapter_process::{NativeCommand, capture};
use fleetd_adapter_execution::vm::{bootstrap, domain_xml};
use fleetd_domain::execution::{Mount, Network, Profile};
use std::{collections::BTreeMap, ffi::OsString, os::unix::fs::PermissionsExt, time::Duration};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn installed_shell_and_openssh_admit_guest_bootstrap_and_enforce_narrow_forwarding()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let command = |binary: &str, arguments: Vec<OsString>| NativeCommand {
        binary: binary.into(),
        arguments,
        workspace: directory.path().to_owned(),
        environment: BTreeMap::new(),
        input: false,
    };
    let id = crossfire_kernel::identity::id();
    let mounts = vec![
        Mount {
            path: "/data/analyst's研究".into(),
            read_only: false,
        },
        Mount {
            path: "/data/originals".into(),
            read_only: true,
        },
    ];
    let script = bootstrap::script(&id, "/data/analyst's研究/ready", &mounts)?;
    assert!(script.contains("'\\''") && script.contains("研究"));
    assert!(script.contains("mount -t virtiofs -o ro"));
    let opened = script.find("exec 3<>").ok_or("Port opening is missing")?;
    let device_wait = script
        .find("/usr/bin/udevadm wait --timeout=30 --settle /dev/virtio-ports/")
        .ok_or("Initialized device wait is missing")?;
    assert!(device_wait < opened);
    let started = script.find("server=$!").ok_or("SSH startup is missing")?;
    let ready = script
        .find("printf")
        .ok_or("Readiness publication is missing")?;
    assert!(opened < started && started < ready);
    let file = directory.path().join("start.sh");
    std::fs::write(&file, script)?;
    let syntax = capture(
        &command("/bin/sh", vec!["-n".into(), file.into_os_string()]),
        8192,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(
        syntax.status.success(),
        "Actual shell admits the generated guest script"
    );
    assert!(bootstrap::script(&id, "/outside/ready", &mounts).is_err());
    let key = directory.path().join("server");
    let generated_key = key.clone();
    let generated = capture(
        &command(
            "/usr/bin/ssh-keygen",
            vec![
                "-q".into(),
                "-t".into(),
                "ed25519".into(),
                "-N".into(),
                "".into(),
                "-f".into(),
                key.into_os_string(),
            ],
        ),
        8192,
        Duration::from_secs(5),
        CancellationToken::new(),
    )
    .await?;
    assert!(generated.status.success());
    std::fs::set_permissions(&generated_key, std::fs::Permissions::from_mode(0o644))?;
    OwnedFile::open(&generated_key, 16384)?
        .ok_or("Generated key is missing")?
        .secure_and_sync()?;
    assert_eq!(
        std::fs::metadata(&generated_key)?.permissions().mode() & 0o777,
        0o600
    );
    for (exit, matching, expected) in [
        (255, false, false),
        (255, true, true),
        (0, false, false),
        (0, true, true),
    ] {
        let ready = directory.path().join("ready");
        std::fs::write(
            directory.path().join("ready.close"),
            format!(
                "{}\n",
                if matching {
                    id.clone()
                } else {
                    crossfire_kernel::identity::id()
                }
            ),
        )?;
        let program = format!(
            "set -eu\n/bin/sh -c 'exit {exit}' &\nserver=$!\n{}",
            bootstrap::completion(&id, ready.to_str().ok_or("Invalid ready path")?)?
        );
        let completed = capture(
            &command("/bin/sh", vec!["-c".into(), program.into()]),
            4096,
            Duration::from_secs(5),
            CancellationToken::new(),
        )
        .await?;
        assert_eq!(
            completed.status.success(),
            expected,
            "Only matching host teardown explains normal SSH disconnection"
        );
        let record: serde_json::Value = serde_json::from_str(&completed.errors)?;
        assert_eq!(record["expected"].as_bool(), Some(expected));
        assert_eq!(record["exitCode"].as_i64(), Some(exit));
    }
    for port in [None, Some(31234)] {
        let configuration = bootstrap::ssh_configuration(port)?.replace(
            &format!("{}/ssh", bootstrap::GUEST_ROOT),
            directory.path().to_str().ok_or("Invalid fixture path")?,
        );
        let file = directory.path().join("sshd_config");
        std::fs::write(&file, configuration)?;
        let admitted = capture(
            &command(
                "/usr/sbin/sshd",
                vec!["-T".into(), "-f".into(), file.into_os_string()],
            ),
            32768,
            Duration::from_secs(5),
            CancellationToken::new(),
        )
        .await?;
        assert!(
            admitted.status.success(),
            "OpenSSH configuration admission: {}",
            admitted.errors
        );
        assert!(admitted.output.contains("passwordauthentication no\n"));
        assert!(admitted.output.contains("allowagentforwarding no\n"));
        assert!(admitted.output.contains("permitopen 127.0.0.1:*\n"));
        assert!(admitted.output.contains(&format!(
            "permitlisten {}\n",
            port.map_or_else(|| "none".to_owned(), |port| format!("127.0.0.1:{port}"))
        )));
    }
    for network in [Network::Disabled, Network::Outbound] {
        let start = bootstrap::start_command(network);
        assert!(
            start.contains(&"--no-block".to_owned())
                && start.contains(&"--service-type=exec".to_owned())
        );
        assert_eq!(
            start.contains(&"--property=After=network-online.target".to_owned()),
            network == Network::Outbound
        );
        assert_eq!(
            start.contains(&"--property=Wants=network-online.target".to_owned()),
            network == Network::Outbound
        );
        let profile = Profile {
            cpus: 1,
            memory_mib: 512,
            maximum_memory_mib: 1024,
            network,
            mounts: mounts.clone(),
        };
        let files = domain_xml::BootFiles {
            overlay: directory.path().join("disk.qcow2"),
            seed: directory.path().join("seed.img"),
            nvram: directory.path().join("nvram.fd"),
            serial: directory.path().join("serial.log"),
            bootstrap: directory.path().to_owned(),
            channel: directory.path().join("channel"),
        };
        let xml = domain_xml::create(
            &id,
            &profile,
            &mounts,
            &files,
            &domain_xml::HostFiles::default(),
        )?;
        assert!(xml.contains(&format!("<name>vm</name><uuid>{id}</uuid>")));
        assert!(
            xml.contains("<memory unit=\"MiB\">1024</memory>")
                && xml.contains("<currentMemory unit=\"MiB\">512</currentMemory>")
        );
        assert_eq!(
            xml.matches("<interface").count(),
            usize::from(network == Network::Outbound)
        );
        assert_eq!(xml.matches("<filesystem").count(), 3);
        assert_eq!(
            xml.matches("<readonly/>").count(),
            3,
            "Seed, readonly originals and bootstrap are readonly"
        );
        assert!(xml.contains("analyst&apos;s研究"));
        let file = directory.path().join("domain.xml");
        std::fs::write(&file, xml)?;
        let admitted = capture(
            &command(
                "/usr/bin/virt-xml-validate",
                vec![file.into_os_string(), "domain".into()],
            ),
            32768,
            Duration::from_secs(5),
            CancellationToken::new(),
        )
        .await?;
        assert!(
            admitted.status.success(),
            "Installed libvirt schema admission: {}",
            admitted.errors
        );
    }
    Ok(())
}
