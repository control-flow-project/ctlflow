using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Fleetd.AdapterExecution.Vm;

public static class Supervisor
{
    public const string Mode = "--fleetd-vm-supervisor";
    public static bool Requested(string[] arguments) => arguments.FirstOrDefault() == Mode;
    public static async Task Run(string[] arguments)
    {
        if (arguments is not [Mode, var file]) throw new ArgumentException("Invalid VM supervisor invocation");
        var request = VmRequest.Read(file); var selection = request.Select();
        var group = ExecutionState.CurrentGroup();
        Groups.Validate(request, selection);
        using var owner = NativeOwnership.Acquire(request.Native.Directory, request.Native.Workspace, request.Native.Home);
        if (ExecutionState.ClosedId(request.Native.Directory) is { } previous) ExecutionFiles.Remove(previous);
        ExecutionState.Publish(request.Native.Directory, new(request.Id, group));
        using var stop = new CancellationTokenSource();
        using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, signal => { signal.Cancel = true; stop.Cancel(); });
        using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, signal => { signal.Cancel = true; stop.Cancel(); });
        using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, signal => { signal.Cancel = true; stop.Cancel(); });
        var controller = WatchController(stop);
        var started = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); long? ready = null;
        Receipt.Write(request, started, null, null, null);
        await Status(request, "admitted");
        try
        {
            await Boot(request, selection, () => { ready = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); Receipt.Write(request, started, ready, null, null); }, stop.Token);
            Receipt.Write(request, started, ready, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), null);
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        { Receipt.Write(request, started, ready, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), null); }
        catch (Exception error)
        {
            Receipt.Write(request, started, ready, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), error.Message);
            await Status(request, "failed", TextRules.TruncateUtf16(error.Message, 8192));
            // Guest/helper teardown has finished, but the host runtime still
            // owns this lease. Retain it until that owner closes its pipe.
            try { await Task.Delay(Timeout.Infinite, stop.Token); } catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            throw;
        }
        finally { await stop.CancelAsync(); _ = controller; await Groups.Closed(); ExecutionFiles.Remove(request.Id); }
    }
    private static async Task WatchController(CancellationTokenSource stop)
    {
        try
        {
            // Console's synchronized reader may block before returning its Task.
            // Keep that one lifetime read off the supervisor's startup thread.
            var input = await Task.Run(Console.In.ReadLine, stop.Token);
            if (input is not (null or "close")) Console.Error.WriteLine("Invalid VM controller lifetime input");
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
        finally { if (!stop.IsCancellationRequested) await stop.CancelAsync(); }
    }
    private static async Task Command(VmRequest request, string binary, IReadOnlyList<string> arguments, CancellationToken cancellation)
    {
        var result = await NativeProcess.Capture(new(binary, arguments, request.Directory, new Dictionary<string, string?>()), 65536, 30000, cancellation);
        if (!result.IsSuccess || result.Value.ExitCode != 0) throw new IOException(result.IsSuccess ? result.Value.Errors : result.Error.Message);
    }
    private static async Task Boot(VmRequest request, VmSelection selection, Action ready, CancellationToken cancellation)
    {
        try { using var kvm = File.Open("/dev/kvm", FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { throw new IOException("The fleetd user service cannot open /dev/kvm; its OS-user session needs the configured KVM permissions", error); }
        if (!File.Exists(VmHostFiles.Installed.FirmwareCode) || !File.Exists(VmHostFiles.Installed.FirmwareVariables))
            throw new IOException("VM firmware is missing; install the prescribed VM host prerequisites");
        var verified = await Images.Verify(selection.Image, cancellation);
        if (!verified.IsSuccess) throw new IOException(verified.Error.Message);
        var root = request.Scratch; var runtime = request.Directory;
        var environment = new Dictionary<string, string?> { ["DBUS_SESSION_BUS_ADDRESS"] = null, ["LIBVIRT_DEFAULT_URI"] = null };
        foreach (var (key, name) in new[] { ("XDG_RUNTIME_DIR", "r"), ("XDG_CONFIG_HOME", "c"), ("XDG_CACHE_HOME", "k"), ("XDG_DATA_HOME", "d") })
            // Libvirt also creates QMP sockets beneath its configuration root.
            environment[key] = PrivateFiles.Directory(Path.Combine(key is "XDG_RUNTIME_DIR" or "XDG_CONFIG_HOME" ? runtime : root, name));
        var boot = PrivateFiles.Directory(Path.Combine(root, "boot"));
        await Command(request, "/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", Path.Combine(runtime, "client")], cancellation);
        await Command(request, "/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", Path.Combine(boot, "server")], cancellation);
        PrivateFiles.SecureGeneratedFile(Path.Combine(runtime, "client"), 16384);
        PrivateFiles.SecureGeneratedFile(Path.Combine(boot, "server"), 16384);
        var publicKey = Encoding.UTF8.GetString(PrivateFiles.ReadConfiguration(Path.Combine(boot, "server.pub"), 4096)).Split(' ');
        Write(runtime, "known_hosts", "ctlflow-" + request.Id + " " + publicKey[0] + " " + publicKey[1] + "\n");
        PrivateFiles.Write(Path.Combine(boot, "authorized_keys"), PrivateFiles.ReadConfiguration(Path.Combine(runtime, "client.pub"), 4096), 4096);
        var password = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        var hashed = await NativeProcess.Capture(new("/usr/bin/openssl", ["passwd", "-6", password], root, new Dictionary<string, string?>()), 4096, 10000, cancellation);
        if (!hashed.IsSuccess || hashed.Value.ExitCode != 0) throw new IOException("Cannot initialize the disposable guest account");
        Write(boot, "account-hash", hashed.Value.Output.Trim() + "\n");
        Write(boot, "sshd_config", Bootstrap.SshConfiguration(request.ListenerPort));
        Write(boot, "start.sh", Bootstrap.Script(request.Id, request.Ready, selection.Mounts));
        var files = new VmBootFiles(Path.Combine(root, "overlay.qcow2"), Path.Combine(root, "seed.img"), Path.Combine(root, "nvram.fd"),
            Path.Combine(root, "serial.log"), boot, Path.Combine(runtime, "channel"));
        await Command(request, "/usr/bin/qemu-img", ["create", "-f", "qcow2", "-F", "qcow2", "-b", selection.Image.Path, files.Overlay], cancellation);
        Write(root, "user-data", "#cloud-config\n" + WireJson.Object(writer =>
        {
            writer.WriteBoolean("ssh_pwauth", false); writer.WriteBoolean("disable_root", true);
            writer.WriteStartArray("bootcmd"); writer.WriteStartArray();
            foreach (var argument in Bootstrap.StartCommand(selection.Profile.Network)) writer.WriteStringValue(argument);
            writer.WriteEndArray(); writer.WriteEndArray();
        }).GetRawText());
        Write(root, "meta-data", WireJson.Object(writer => { writer.WriteString("instance-id", request.Id); writer.WriteString("local-hostname", "ctlflow-execution"); }).GetRawText());
        await Command(request, "/usr/bin/cloud-localds", [files.Seed, Path.Combine(root, "user-data"), Path.Combine(root, "meta-data")], cancellation);
        Write(root, "domain.xml", DomainXml.Create(request.Id, selection.Profile, selection.Mounts, files, VmHostFiles.Installed));
        var uri = "qemu+unix:///session?socket=" + Path.Combine(runtime, "r/libvirt/libvirt-sock");
        Helper? logger = null, daemon = null, domain = null, master = null;
        try
        {
            logger = new(new("/usr/sbin/virtlogd", ["--timeout", "120"], root, environment));
            await Helper.Wait(() => Helper.SocketReady(Path.Combine(runtime, "r/libvirt/virtlogd-sock")), [logger], 10, cancellation);
            daemon = new(new("/usr/sbin/libvirtd", ["--timeout", "120"], root, environment));
            await Helper.Wait(() => Helper.SocketReady(Path.Combine(runtime, "r/libvirt/libvirt-sock")), [logger, daemon], 10, cancellation);
            domain = new(new("/usr/bin/virsh", ["--connect", uri, "--quiet"], root, new Dictionary<string, string?> { ["LC_ALL"] = "C" }, true));
            await domain.Process.Input.WriteLineAsync("create domain.xml --autodestroy");
            await domain.Process.Input.FlushAsync();
            await Helper.Wait(() =>
                {
                    if (domain.Diagnostic.Contains("error:", StringComparison.OrdinalIgnoreCase)) throw new IOException("VM creation failed: " + domain.Diagnostic);
                    return PrivateFiles.Exists(request.Ready) && Encoding.UTF8.GetString(PrivateFiles.Read(request.Ready, 128)).Trim() == request.Id;
                },
                [logger, daemon, domain], 180, cancellation);
            await Helper.Wait(() => Groups.Ready(selection.Mounts.Count + 1), [logger, daemon, domain], 10, cancellation);
            var command = SshCommands.Master(runtime, request.Id, request.ListenerPort);
            if (!command.IsSuccess) throw new IOException(command.Error.Message);
            master = new(command.Value);
            var deadline = System.Diagnostics.Stopwatch.StartNew();
            for (;;)
            {
                cancellation.ThrowIfCancellationRequested(); master.Check(); domain.Check(); daemon.Check(); logger.Check();
                var checkedConnection = await NativeProcess.Capture(SshCommands.Check(runtime, request.Id).Value, 4096, 2000, cancellation);
                if (checkedConnection.IsSuccess && checkedConnection.Value.ExitCode == 0) break;
                if (deadline.Elapsed >= TimeSpan.FromSeconds(30)) throw new IOException("VM SSH connection failed: " + master.Diagnostic);
            }
            ready(); await Status(request, "ready");
            await Task.WhenAny(Task.Delay(Timeout.Infinite, cancellation), master.Process.Ended, domain.Process.Ended, daemon.Process.Ended, logger.Process.Ended);
            if (!cancellation.IsCancellationRequested) throw new IOException("VM execution lost an owned helper: " + string.Join('\n', new[] { master, domain, daemon, logger }.Select(helper => helper.Diagnostic)));
        }
        finally
        {
            Write(request.Native.StateDirectory, Path.GetFileName(request.Ready) + ".close", request.Id + "\n");
            List<Exception> errors = [];
            foreach (var helper in new[] { master, domain, daemon, logger })
                if (helper is not null) try { await helper.DisposeAsync(); } catch (Exception error) { errors.Add(error); }
            if (errors.Count != 0) throw new AggregateException("VM helper teardown failed; its service retains the execution fence until empty", errors);
            await Groups.Closed();
        }
    }
    private static void Write(string directory, string name, string text)
        => PrivateFiles.Write(Path.Combine(directory, name), Encoding.UTF8.GetBytes(text), 65536);
    private static async Task Status(VmRequest request, string state, string? error = null)
    {
        Console.WriteLine(WireJson.Object(writer =>
        { writer.WriteString("id", request.Id); writer.WriteString("state", state); if (error is not null) writer.WriteString("error", error); }).GetRawText());
        await Console.Out.FlushAsync();
    }
}
