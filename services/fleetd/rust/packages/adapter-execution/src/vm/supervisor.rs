use super::{
    bootstrap,
    domain_xml::{self, BootFiles, HostFiles},
    helpers::{self, Helper},
    images,
    request::{Request, Selection, invalid},
};
use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_process::{NativeCommand, capture, ssh_commands};
use crossfire_adapter_runtime::{
    execution_state::{self, ExecutionState},
    ownership,
};
use crossfire_kernel::{Result, identity};
use serde_json::json;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::Path,
    time::{Duration, Instant},
};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

pub const MODE: &str = "--fleetd-vm-supervisor";
pub async fn run(arguments: &[String]) -> Result<()> {
    let [mode, file] = arguments else {
        return Err(invalid("Invalid VM supervisor invocation"));
    };
    if mode != MODE {
        return Err(invalid("Invalid VM supervisor invocation"));
    }
    let request = Request::read(Path::new(file))?;
    let selection = request.select()?;
    let group = execution_state::current_group()?;
    super::groups::validate(&request, &selection)?;
    let _owner = ownership::acquire(
        &request.native.directory,
        &request.native.workspace,
        &request.native.home,
    )?;
    if let Some(previous) = execution_state::closed_id(&request.native.directory)? {
        super::execution_files::remove(&previous)?;
    }
    execution_state::publish(
        &request.native.directory,
        &ExecutionState {
            id: request.id.clone(),
            group,
        },
    )?;
    let stop = CancellationToken::new();
    let controller_stop = stop.clone();
    // A detached OS thread avoids Tokio's uncancellable blocking stdin worker
    // delaying process exit after a signal while the controller is still alive.
    let _controller = std::thread::Builder::new()
        .name("vm-controller".to_owned())
        .spawn(move || {
            let mut line = String::new();
            let _read = std::io::stdin().read_line(&mut line);
            if !line.is_empty() && line != "close\n" {
                eprintln!("Invalid VM controller lifetime input");
            }
            controller_stop.cancel();
        })
        .map_err(|_| invalid("Cannot observe VM controller lifetime pipe"))?;
    let signal_stop = stop.clone();
    use tokio::signal::unix::{SignalKind, signal};
    let mut terminate =
        signal(SignalKind::terminate()).map_err(|_| invalid("Cannot observe VM termination"))?;
    let mut interrupt =
        signal(SignalKind::interrupt()).map_err(|_| invalid("Cannot observe VM interruption"))?;
    let mut hangup =
        signal(SignalKind::hangup()).map_err(|_| invalid("Cannot observe VM hangup"))?;
    let signals = tokio::spawn(async move {
        tokio::select! { _=signal_stop.cancelled()=>{}, _=terminate.recv()=>signal_stop.cancel(), _=interrupt.recv()=>signal_stop.cancel(), _=hangup.recv()=>signal_stop.cancel() };
        Ok::<(), crossfire_kernel::Failure>(())
    });
    let started = identity::now()?;
    let mut ready = None;
    super::receipt::write(&request, started, None, None, None)?;
    status(&request, "admitted", None);
    let result = boot(&request, &selection, started, &mut ready, stop.clone()).await;
    super::receipt::write(
        &request,
        started,
        ready,
        Some(identity::now()?),
        result.as_ref().err().map(|error| error.message.as_str()),
    )?;
    if let Err(error) = &result {
        status(
            &request,
            "failed",
            Some(crossfire_kernel::text::truncate_utf16(&error.message, 8192)),
        );
        // Keep the host runtime's lease after guest teardown until its
        // controller closes the lifetime pipe, including startup failures.
        stop.cancelled().await;
    }
    stop.cancel();
    signals.abort();
    super::groups::closed().await?;
    super::execution_files::remove(&request.id)?;
    result
}
fn command(root: &Path, binary: &str, arguments: Vec<OsString>) -> NativeCommand {
    NativeCommand {
        binary: binary.into(),
        arguments,
        workspace: root.to_owned(),
        environment: BTreeMap::new(),
        input: false,
    }
}
async fn execute(
    request: &Request,
    binary: &str,
    arguments: Vec<OsString>,
    stop: CancellationToken,
) -> Result<String> {
    let output = capture(
        &command(&request.directory, binary, arguments),
        65536,
        Duration::from_secs(30),
        stop,
    )
    .await?;
    if !output.status.success() {
        return Err(invalid(&output.errors));
    }
    Ok(output.output)
}
fn write(directory: &Path, name: &str, text: &str) -> Result<()> {
    PrivateDirectory::open(directory, false)?.write_atomic(name, text.as_bytes())
}
async fn boot(
    request: &Request,
    selection: &Selection,
    started: i64,
    ready: &mut Option<i64>,
    stop: CancellationToken,
) -> Result<()> {
    let _kvm = std::fs::OpenOptions::new().read(true).write(true).open("/dev/kvm")
        .map_err(|_| invalid("The fleetd user service cannot open /dev/kvm; its OS-user session needs the configured KVM permissions"))?;
    let host = HostFiles::default();
    if !host.firmware_code.is_file() || !host.firmware_variables.is_file() {
        return Err(invalid(
            "VM firmware is missing; install the prescribed VM host prerequisites",
        ));
    }
    images::verify(&selection.image, stop.clone()).await?;
    let scratch = request.scratch()?;
    let root = &scratch;
    let runtime = &request.directory;
    let mut environment = BTreeMap::new();
    environment.insert("DBUS_SESSION_BUS_ADDRESS".into(), None);
    environment.insert("LIBVIRT_DEFAULT_URI".into(), None);
    for (key, name) in [
        ("XDG_RUNTIME_DIR", "r"),
        ("XDG_CONFIG_HOME", "c"),
        ("XDG_CACHE_HOME", "k"),
        ("XDG_DATA_HOME", "d"),
    ] {
        // Libvirt also creates QMP sockets beneath its configuration root.
        let path = if matches!(key, "XDG_RUNTIME_DIR" | "XDG_CONFIG_HOME") {
            runtime.join(name)
        } else {
            root.join(name)
        };
        PrivateDirectory::open(&path, true)?;
        environment.insert(OsString::from(key), Some(path.into_os_string()));
    }
    let boot = root.join("boot");
    PrivateDirectory::open(&boot, true)?;
    for key in [runtime.join("client"), boot.join("server")] {
        let generated = key.clone();
        execute(
            request,
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
            stop.clone(),
        )
        .await?;
        OwnedFile::open(&generated, 16384)?
            .ok_or_else(|| invalid("Generated VM SSH key is missing"))?
            .secure_and_sync()?;
    }
    let public = fleetd_storage::configuration::text(&boot.join("server.pub"), 4096)?;
    let public: Vec<_> = public.split_whitespace().collect();
    if public.len() < 2 {
        return Err(invalid("Invalid VM server public key"));
    }
    write(
        runtime,
        "known_hosts",
        &format!("ctlflow-{} {} {}\n", request.id, public[0], public[1]),
    )?;
    write(
        &boot,
        "authorized_keys",
        &fleetd_storage::configuration::text(&runtime.join("client.pub"), 4096)?,
    )?;
    let password = identity::secret()?;
    let hashed = execute(
        request,
        "/usr/bin/openssl",
        vec!["passwd".into(), "-6".into(), password.expose().into()],
        stop.clone(),
    )
    .await?;
    write(&boot, "account-hash", &(hashed.trim().to_owned() + "\n"))?;
    write(
        &boot,
        "sshd_config",
        &bootstrap::ssh_configuration(request.listener_port)?,
    )?;
    write(
        &boot,
        "start.sh",
        &bootstrap::script(
            &request.id,
            request
                .ready()
                .to_str()
                .ok_or_else(|| invalid("VM readiness path must be UTF-8"))?,
            &selection.mounts,
        )?,
    )?;
    let files = BootFiles {
        overlay: root.join("overlay.qcow2"),
        seed: root.join("seed.img"),
        nvram: root.join("nvram.fd"),
        serial: root.join("serial.log"),
        bootstrap: boot,
        channel: runtime.join("channel"),
    };
    execute(
        request,
        "/usr/bin/qemu-img",
        vec![
            "create".into(),
            "-f".into(),
            "qcow2".into(),
            "-F".into(),
            "qcow2".into(),
            "-b".into(),
            selection.image.path.clone().into_os_string(),
            files.overlay.clone().into_os_string(),
        ],
        stop.clone(),
    )
    .await?;
    write(
        root,
        "user-data",
        &format!(
            "#cloud-config\n{}",
            json!({"ssh_pwauth":false,"disable_root":true,"bootcmd":[bootstrap::start_command(selection.profile.network)]})
        ),
    )?;
    write(
        root,
        "meta-data",
        &json!({"instance-id":request.id,"local-hostname":"ctlflow-execution"}).to_string(),
    )?;
    execute(
        request,
        "/usr/bin/cloud-localds",
        vec![
            files.seed.clone().into_os_string(),
            root.join("user-data").into_os_string(),
            root.join("meta-data").into_os_string(),
        ],
        stop.clone(),
    )
    .await?;
    write(
        root,
        "domain.xml",
        &domain_xml::create(
            &request.id,
            &selection.profile,
            &selection.mounts,
            &files,
            &HostFiles::default(),
        )?,
    )?;
    let mut owned = vec![];
    let result = control(
        request,
        environment,
        &mut owned,
        started,
        ready,
        selection.mounts.len() + 1,
        stop.clone(),
    )
    .await;
    let closing = request.ready();
    let name = closing
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid("Invalid VM readiness file"))?;
    let marked = write(
        &request.native.state_directory,
        &format!("{name}.close"),
        &(request.id.clone() + "\n"),
    );
    let mut cleanup = Ok(());
    for helper in owned.iter().rev() {
        if let Err(error) = helper.close().await {
            cleanup = Err(error);
        }
    }
    let containment = super::groups::closed().await;
    (if stop.is_cancelled() { Ok(()) } else { result })
        .and(marked)
        .and(cleanup)
        .and(containment)
}
async fn control(
    request: &Request,
    environment: BTreeMap<OsString, Option<OsString>>,
    owned: &mut Vec<Helper>,
    started: i64,
    ready: &mut Option<i64>,
    exports: usize,
    stop: CancellationToken,
) -> Result<()> {
    let root = &request.directory;
    let mut logger = command(
        root,
        "/usr/sbin/virtlogd",
        vec!["--timeout".into(), "120".into()],
    );
    logger.environment = environment.clone();
    owned.push(Helper::start(&logger)?);
    helpers::wait(
        || helpers::socket_ready(&root.join("r/libvirt/virtlogd-sock")),
        owned,
        10,
        &stop,
    )
    .await?;
    let mut daemon = command(
        root,
        "/usr/sbin/libvirtd",
        vec!["--timeout".into(), "120".into()],
    );
    daemon.environment = environment;
    owned.push(Helper::start(&daemon)?);
    helpers::wait(
        || helpers::socket_ready(&root.join("r/libvirt/libvirt-sock")),
        owned,
        10,
        &stop,
    )
    .await?;
    let uri = format!(
        "qemu+unix:///session?socket={}",
        root.join("r/libvirt/libvirt-sock").display()
    );
    let mut domain = command(
        &request.scratch()?,
        "/usr/bin/virsh",
        vec!["--connect".into(), uri.into(), "--quiet".into()],
    );
    domain.input = true;
    domain.environment.insert("LC_ALL".into(), Some("C".into()));
    owned.push(Helper::start(&domain)?);
    let input = owned[2]
        .input
        .as_mut()
        .ok_or_else(|| invalid("Owned libvirt connection has no lifetime pipe"))?;
    input
        .write_all(b"create domain.xml --autodestroy\n")
        .await
        .map_err(|_| invalid("Cannot create owned VM"))?;
    input
        .flush()
        .await
        .map_err(|_| invalid("Cannot flush owned VM creation"))?;
    helpers::wait(
        || {
            if owned[2]
                .diagnostic()
                .to_ascii_lowercase()
                .contains("error:")
            {
                return Err(invalid(&format!(
                    "VM creation failed: {}",
                    owned[2].diagnostic()
                )));
            }
            let Some(file) = OwnedFile::open(&request.ready(), 128)? else {
                return Ok(false);
            };
            file.private_permissions()?;
            Ok(file.configuration(128)? == (request.id.clone() + "\n").as_bytes())
        },
        owned,
        180,
        &stop,
    )
    .await?;
    helpers::wait(|| super::groups::ready(exports), owned, 10, &stop).await?;
    owned.push(Helper::start(&ssh_commands::master(
        root,
        &request.id,
        request.listener_port,
    )?)?);
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        for helper in owned.iter() {
            helper.check()?;
        }
        let ready = capture(
            &ssh_commands::check(root, &request.id)?,
            4096,
            Duration::from_secs(2),
            stop.clone(),
        )
        .await?;
        if ready.status.success() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(invalid(&format!(
                "VM SSH connection failed: {}",
                owned[3].diagnostic()
            )));
        }
    }
    *ready = Some(identity::now()?);
    super::receipt::write(request, started, *ready, None, None)?;
    status(request, "ready", None);
    loop {
        for helper in owned.iter() {
            helper.check()?;
        }
        tokio::select! { biased; _=stop.cancelled()=>return Ok(()), _=tokio::time::sleep(Duration::from_millis(25))=>{} }
    }
}
fn status(request: &Request, state: &str, error: Option<&str>) {
    let mut value = json!({"id":request.id,"state":state});
    if let Some(error) = error {
        value["error"] = json!(error);
    }
    println!("{value}");
}
