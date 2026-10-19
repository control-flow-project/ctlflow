using System.Runtime.InteropServices;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.Server;

public static class ServerOperator
{
    public static async Task Run(string[] arguments)
    {
        if (arguments.Length == 0 || arguments is ["--help"]) { Console.WriteLine("crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR --package PACKAGE_DIR [--port PORT] [--content-port PORT] [--cgroup-parent EXISTING.slice]\nUses rootless Docker, a verified package and backup, and the shared Knex migration container. The package selects the backend without a source checkout. No host services or data resets."); return; }
        var action = arguments[0]; if (action is not ("init" or "start")) throw new ArgumentException("Use init or start"); var allowed = action == "init" ? new[] { "directory", "instance", "origin", "content-origin", "server-name", "administrator" } : ["directory", "package", "port", "content-port", "cgroup-parent"]; var options = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 1; index < arguments.Length; index++) { var key = arguments[index]; if (!key.StartsWith("--", StringComparison.Ordinal) || !allowed.Contains(key[2..], StringComparer.Ordinal)) throw new ArgumentException("Invalid option " + key); var value = index + 1 < arguments.Length ? arguments[++index] : throw new ArgumentException("Missing value for " + key); if (!options.TryAdd(key[2..], value) || value.Length == 0) throw new ArgumentException("Duplicated or empty option " + key); }
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("The C# operator requires Linux"); var directory = Path.GetFullPath(options.GetValueOrDefault("directory") ?? throw new ArgumentException("Supply --directory"));
        if (action == "init") { Initialize(directory, options); return; }
        PrivateFiles.ExistingDirectory(directory, true); var config = Parse(Configurations.Parse(WireJson.Parse(PrivateFiles.Read(Path.Combine(directory, "config.json"), 65536)))); var package = Path.GetFullPath(options.GetValueOrDefault("package") ?? throw new ArgumentException("Supply an explicit --package directory"));
        var port = Port(options.GetValueOrDefault("port") ?? (new Uri(config.PublicOrigin).IsDefaultPort ? "8080" : new Uri(config.PublicOrigin).Port.ToString(System.Globalization.CultureInfo.InvariantCulture))); var contentPort = Port(options.GetValueOrDefault("content-port") ?? "8082"); if (port == contentPort) throw new ArgumentException("Content and application ports must differ"); var resources = ContainerCommands.Resources(options.GetValueOrDefault("cgroup-parent"));
        using var ownership = new StateLock(Path.Combine(directory, "operator"));
        using var stop = new CancellationTokenSource(); using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; stop.Cancel(); }); using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; stop.Cancel(); }); using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, context => { context.Cancel = true; stop.Cancel(); });
        var docker = await ContainerCommands.Capture(["info", "--format", "{{json .SecurityOptions}}"], directory, stop.Token); if (docker.ExitCode != 0 || !docker.Output.Contains("rootless", StringComparison.Ordinal)) throw new IOException("A working rootless Docker engine is required; Crossfire changes no host settings");
        var selected = await ContainerPackage.Prepare(package, directory, stop.Token);
        var name = ContainerLifecycle.Names(directory).Runtime;
        await ContainerLifecycle.Reconcile(directory, directory, stop.Token);
        stop.Token.ThrowIfCancellationRequested(); var backup = DatabaseUpgrade.BackupBeforeMigration(directory); if (backup is not null) Console.WriteLine("Verified pre-migration backup: " + backup); var migration = ContainerCommands.Migration(directory, selected.MigrationImage, resources); await ContainerLifecycle.Owned(migration, directory, stop.Token); stop.Token.ThrowIfCancellationRequested();
        Console.WriteLine("Public: " + config.PublicOrigin + "/\nManagement: " + config.PublicOrigin + "/manage/\nContent: " + config.ContentOrigin + "/"); await ContainerLifecycle.Owned(ContainerCommands.Server(directory, selected.RuntimeImage, name, port, contentPort, resources), directory, stop.Token);
    }
    private static T Parse<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new ArgumentException(value.Error.Message);
    private static int Port(string value) => value.Length is >= 4 and <= 5 && value[0] is >= '1' and <= '9'
        && value.All(character => character is >= '0' and <= '9')
        && int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var port) && port is >= 1024 and <= 65535
        ? port : throw new ArgumentException("Port must be a canonical decimal integer within 1024..65535");
    private static void Initialize(string directory, IReadOnlyDictionary<string, string> options)
    {
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any()) throw new IOException("Initialization requires an empty directory; existing data is never overwritten"); var username = options.GetValueOrDefault("administrator") ?? "";
        var administrator = Parse(MatrixSettings.AdministratorUser(username, options.GetValueOrDefault("server-name")));
        var configuration = WireJson.Object(writer =>
        {
            foreach (var pair in new[] { ("instance", "instance"), ("publicOrigin", "origin"), ("contentOrigin", "content-origin") }) writer.WriteString(pair.Item1, options.GetValueOrDefault(pair.Item2));
            writer.WriteString("administrator", administrator); writer.WriteStartObject("messaging"); writer.WriteString("type", "matrix");
            writer.WriteStartObject("parameters"); writer.WriteString("serverName", options.GetValueOrDefault("server-name")); writer.WriteString("origin", "http://127.0.0.1:6167");
            writer.WriteString("jwtSecret", Identity.Secret()); writer.WriteString("registrationSecret", Identity.Secret()); writer.WriteEndObject(); writer.WriteEndObject();
        }); var parsed = Parse(Configurations.Parse(configuration)); Parse(MatrixSettings.Read(parsed.Messaging, parsed.Instance, parsed.Administrator)); PrivateFiles.Directory(directory);
        PrivateFiles.Write(Path.Combine(directory, "config.json"), WireJson.Bytes(configuration, true), 65536); PrivateFiles.Write(Path.Combine(directory, "bootstrap.json"), WireJson.Bytes(WireJson.Object(writer => { writer.WriteString("servicePassword", Identity.Secret()); writer.WriteString("administratorPassword", Identity.Secret()); }), true), 16384); Console.WriteLine("Initialized " + directory + "\nAdministrator: " + parsed.Administrator + "\nInitial password: administratorPassword in " + Path.Combine(directory, "bootstrap.json"));
    }
}
