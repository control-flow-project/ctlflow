using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;
using Fleetd.AdapterExecution.Vm;
using Fleetd.Domain;

[assembly: SupportedOSPlatform("linux")]

if (Supervisor.Requested(args)) { await Supervisor.Run(args); return; }
if (args.Length != 0) throw new ArgumentException("VM execution acceptance takes no suite flags");
var assertions = 0;
void Check(bool value, string label) { if (!value) throw new InvalidOperationException(label); assertions++; }
var root = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "fleet-vm-bootstrap-" + Identity.Identifier()));
try
{
    await SshCommandsAcceptance.Run(root, Check);
    await ResourcesAcceptance.Run(root, Check);
    await ImagesAcceptance.Run(root, Check);
    await BudgetAcceptance.Run(root, Check);
    await ListenerAcceptance.Run(root, Check);
    RequestAcceptance.Run(root, Check);
    var id = Identity.Identifier(); var ready = "/data/analyst's研究/ready";
    var mounts = new VmMount[] { new("/data/analyst's研究", false), new("/data/originals", true) };
    var script = Bootstrap.Script(id, ready, mounts);
    Check(script.Contains("'\\''", StringComparison.Ordinal) && script.Contains("研究", StringComparison.Ordinal), "Guest script retains exact quoted Unicode paths");
    Check(script.Contains("mount -t virtiofs -o ro", StringComparison.Ordinal), "Guest requests the approved readonly mount");
    var openedPort = script.IndexOf("exec 3<>", StringComparison.Ordinal); var startedSsh = script.IndexOf("server=$!", StringComparison.Ordinal); var readyPublished = script.IndexOf("printf", StringComparison.Ordinal);
    var deviceWait = script.IndexOf("/usr/bin/udevadm wait --timeout=30 --settle /dev/virtio-ports/", StringComparison.Ordinal);
    Check(deviceWait >= 0 && deviceWait < openedPort, "Early cloud-init waits for the initialized virtio device before opening it");
    Check(openedPort >= 0 && startedSsh > openedPort && readyPublished > startedSsh, "Readiness follows port opening and SSH daemon launch");
    var file = Path.Combine(root, "start.sh"); PrivateFiles.Write(file, System.Text.Encoding.UTF8.GetBytes(script), 65536);
    var syntax = await NativeProcess.Capture(new("/bin/sh", ["-n", file], root, new Dictionary<string, string?>()), 8192, 5000, CancellationToken.None);
    Check(syntax.IsSuccess && syntax.Value.ExitCode == 0, "Actual POSIX shell admits the generated guest script");
    try { Bootstrap.Script(id, "/outside/ready", mounts); throw new InvalidOperationException("Unexported readiness was accepted"); }
    catch (ArgumentException) { Check(true, "Readiness requires a writable approved export"); }
    var key = Path.Combine(root, "server");
    var generated = await NativeProcess.Capture(new("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], root, new Dictionary<string, string?>()), 8192, 5000, CancellationToken.None);
    Check(generated.IsSuccess && generated.Value.ExitCode == 0, "Ephemeral SSH fixture key is generated without provider credentials");
    File.SetUnixFileMode(key, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
    PrivateFiles.SecureGeneratedFile(key, 16384);
    Check(File.GetUnixFileMode(key) == (UnixFileMode.UserRead | UnixFileMode.UserWrite), "Generated native keys remain private even when default ACLs override umask");
    var linkedKey = Path.Combine(root, "linked-generated-key"); File.CreateSymbolicLink(linkedKey, key);
    var refusedLink = false; try { PrivateFiles.SecureGeneratedFile(linkedKey, 16384); } catch (IOException) { refusedLink = true; }
    Check(refusedLink, "Generated-key protection never follows a symlink");
    var refusedBound = false; try { PrivateFiles.SecureGeneratedFile(key, 1); } catch (IOException) { refusedBound = true; }
    Check(refusedBound, "Generated-key protection keeps its declared file-size bound");
    var unsafeOutput = Path.Combine(root, "shared-generated-output"); File.WriteAllText(unsafeOutput, "fixture");
    File.SetUnixFileMode(unsafeOutput, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupWrite);
    var refusedWrite = false; try { PrivateFiles.SecureGeneratedFile(unsafeOutput, 16384); } catch (IOException) { refusedWrite = true; }
    Check(refusedWrite, "Generated-key protection rejects shared-write outputs rather than adopting them");
    foreach (var (exit, matching, expected) in new[] { (255, false, false), (255, true, true), (0, false, false), (0, true, true) })
    {
        var completionReady = Path.Combine(root, "ready");
        PrivateFiles.Write(completionReady + ".close", System.Text.Encoding.UTF8.GetBytes((matching ? id : Identity.Identifier()) + "\n"), 128);
        var completion = "set -eu\n/bin/sh -c 'exit " + exit.ToString(System.Globalization.CultureInfo.InvariantCulture) + "' &\nserver=$!\n" + Bootstrap.Completion(id, completionReady);
        var completed = await NativeProcess.Capture(new("/bin/sh", ["-c", completion], root, new Dictionary<string, string?>()), 4096, 5000, CancellationToken.None);
        Check(completed.IsSuccess && (completed.Value.ExitCode == 0) == expected, "Only a matching host teardown explains normal SSH disconnection");
        if (completed.IsSuccess)
        {
            var record = WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(completed.Value.Errors));
            Check(record.GetProperty("expected").GetBoolean() == expected && record.GetProperty("exitCode").GetInt32() == exit, "SSH exit code and teardown classification remain structurally logged");
        }
    }
    foreach (int? port in new int?[] { null, 31234 })
    {
        var configuration = Bootstrap.SshConfiguration(port).Replace(Bootstrap.GuestRoot + "/ssh", root, StringComparison.Ordinal);
        var path = Path.Combine(root, "sshd_config"); PrivateFiles.Write(path, System.Text.Encoding.UTF8.GetBytes(configuration), 16384);
        var admitted = await NativeProcess.Capture(new("/usr/sbin/sshd", ["-T", "-f", path], root, new Dictionary<string, string?>()), 32768, 5000, CancellationToken.None);
        Check(admitted.IsSuccess && admitted.Value.ExitCode == 0, "Installed OpenSSH admits the actual guest configuration" + (admitted.IsSuccess ? ": " + admitted.Value.Errors : ": " + admitted.Error.Message));
        if (!admitted.IsSuccess || admitted.Value.ExitCode != 0) throw new IOException(admitted.IsSuccess ? admitted.Value.Errors : admitted.Error.Message);
        Check(admitted.Value.Output.Contains("passwordauthentication no\n", StringComparison.Ordinal), "Password authentication remains disabled");
        Check(admitted.Value.Output.Contains("allowagentforwarding no\n", StringComparison.Ordinal), "Host SSH agent forwarding remains disabled");
        Check(admitted.Value.Output.Contains("permitopen 127.0.0.1:*\n", StringComparison.Ordinal), "Native endpoint forwards stay inside the guest loopback interface");
        Check(admitted.Value.Output.Contains("permitlisten " + (port is null ? "none" : "127.0.0.1:31234") + "\n", StringComparison.Ordinal), "Only the exact own listener port may be reverse-forwarded");
    }
    foreach (var network in new[] { VmNetwork.Disabled, VmNetwork.Outbound })
    {
        var start = Bootstrap.StartCommand(network);
        Check(start.Contains("--no-block") && start.Contains("--service-type=exec"), "Guest bootstrap never holds cloud-init's early stage open");
        Check(start.Contains("--property=After=network-online.target") == (network == VmNetwork.Outbound)
            && start.Contains("--property=Wants=network-online.target") == (network == VmNetwork.Outbound), "Only outbound execution waits for guest network readiness");
        var profile = new VmProfile(1, 512, 1024, network, mounts);
        var files = new VmBootFiles(Path.Combine(root, "disk.qcow2"), Path.Combine(root, "seed.img"), Path.Combine(root, "nvram.fd"),
            Path.Combine(root, "serial.log"), root, Path.Combine(root, "channel"));
        var xml = DomainXml.Create(id, profile, mounts, files, VmHostFiles.Installed);
        var document = System.Xml.Linq.XElement.Parse(xml);
        Check(document.Element("name")?.Value == "vm" && document.Element("uuid")?.Value == id,
            "Private libvirt keeps a short local socket name and the exact execution UUID");
        Check(document.Element("memory")?.Value == "1024" && document.Element("currentMemory")?.Value == "512", "Guest memory target and maximum are distinct");
        Check(document.Descendants("interface").Count() == (network == VmNetwork.Disabled ? 0 : 1), "Disabled networking has no network interface");
        Check(document.Descendants("filesystem").Count() == 3 && document.Descendants("filesystem").Count(element => element.Element("readonly") is not null) == 2,
            "Native data, readonly originals and readonly bootstrap have exact independent exports");
        Check(document.Descendants("source").Any(element => element.Attribute("dir")?.Value == mounts[0].Path), "XML roundtrip preserves quoted Unicode source paths");
        var path = Path.Combine(root, "domain.xml"); PrivateFiles.Write(path, System.Text.Encoding.UTF8.GetBytes(xml), 65536);
        var admitted = await NativeProcess.Capture(new("/usr/bin/virt-xml-validate", [path, "domain"], root, new Dictionary<string, string?>()), 32768, 5000, CancellationToken.None);
        Check(admitted.IsSuccess && admitted.Value.ExitCode == 0, "Installed libvirt schema admits generated domain XML" + (admitted.IsSuccess ? ": " + admitted.Value.Errors : ": " + admitted.Error.Message));
    }
}
finally { Directory.Delete(root, recursive: true); }
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"fleetd VM bootstrap preflight\",\"assertions\":" + assertions
    + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
