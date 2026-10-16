using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.Server;

public static class ServerOperator
{
    public static async Task Run(string[] arguments)
    {
        if (arguments.Length == 0 || arguments is ["--help"]) { Console.WriteLine("crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\ncrossfire start --directory DIR --source REPOSITORY [--runtime nativeaot|managed] [--port PORT] [--content-port PORT] [--compile] [--cgroup-parent EXISTING.slice]\nUses rootless Docker, a verified backup, the shared Knex migration container and one selected C# runtime. No host services or data resets."); return; }
        var action = arguments[0]; if (action is not ("init" or "start")) throw new ArgumentException("Use init or start"); var allowed = action == "init" ? new[] { "directory", "instance", "origin", "content-origin", "server-name", "administrator" } : ["directory", "source", "runtime", "port", "content-port", "compile", "cgroup-parent"]; var options = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 1; index < arguments.Length; index++) { var key = arguments[index]; if (!key.StartsWith("--", StringComparison.Ordinal) || !allowed.Contains(key[2..], StringComparer.Ordinal)) throw new ArgumentException("Invalid option " + key); var value = key == "--compile" ? "true" : index + 1 < arguments.Length ? arguments[++index] : throw new ArgumentException("Missing value for " + key); if (!options.TryAdd(key[2..], value) || value.Length == 0) throw new ArgumentException("Duplicated or empty option " + key); }
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("The C# operator requires Linux"); var directory = Path.GetFullPath(options.GetValueOrDefault("directory") ?? throw new ArgumentException("Supply --directory"));
        if (action == "init") { Initialize(directory, options); return; }
        PrivateFiles.ExistingDirectory(directory, true); var config = Parse(Configurations.Parse(WireJson.Parse(PrivateFiles.Read(Path.Combine(directory, "config.json"), 65536)))); var source = Path.GetFullPath(options.GetValueOrDefault("source") ?? throw new ArgumentException("Supply --source with the Crossfire source repository")); var runtime = options.GetValueOrDefault("runtime") ?? "nativeaot"; if (runtime is not ("nativeaot" or "managed")) throw new ArgumentException("Select nativeaot or managed explicitly");
        var port = Port(options.GetValueOrDefault("port") ?? (new Uri(config.PublicOrigin).IsDefaultPort ? "8080" : new Uri(config.PublicOrigin).Port.ToString(System.Globalization.CultureInfo.InvariantCulture))); var contentPort = Port(options.GetValueOrDefault("content-port") ?? "8082"); if (port == contentPort) throw new ArgumentException("Content and application ports must differ"); var resources = ContainerCommands.Resources(options.GetValueOrDefault("cgroup-parent"));
        using var ownership = new StateLock(Path.Combine(directory, "operator"));
        using var stop = new CancellationTokenSource(); using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; stop.Cancel(); }); using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; stop.Cancel(); }); using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, context => { context.Cancel = true; stop.Cancel(); });
        var docker = await ContainerCommands.Capture(["info", "--format", "{{json .SecurityOptions}}"], source, stop.Token); if (docker.ExitCode != 0 || !docker.Output.Contains("rootless", StringComparison.Ordinal)) throw new IOException("A working rootless Docker engine is required; Crossfire changes no host settings");
        var digest = ImageDigest(source); var image = "crossfire-csharp-" + runtime + ":" + digest; var assets = "crossfire-assets:" + digest; var migrations = "crossfire-migrations:" + digest; var rebuild = options.ContainsKey("compile");
        foreach (var item in new[] { (Target: "assets", Image: assets), (Target: "migrations", Image: migrations) }) if (rebuild || !await ContainerCommands.Image(item.Image, source, stop.Token)) await ContainerCommands.Run(["build", .. resources, "--file", Path.Combine(source, "services", "crossfire", "node", "Dockerfile"), "--target", item.Target, "--tag", item.Image, source], source, stop.Token);
        if (rebuild || !await ContainerCommands.Image(image, source, stop.Token)) await ContainerCommands.Run(["build", .. resources, "--file", Path.Combine(source, "services", "crossfire", "csharp", "Dockerfile"), "--build-arg", "CROSSFIRE_ASSETS_IMAGE=" + assets, "--target", runtime, "--tag", image, source], source, stop.Token);
        var name = ContainerLifecycle.Names(directory).Runtime;
        await ContainerLifecycle.Reconcile(directory, source, stop.Token);
        stop.Token.ThrowIfCancellationRequested(); var backup = DatabaseUpgrade.BackupBeforeMigration(directory); if (backup is not null) Console.WriteLine("Verified pre-migration backup: " + backup); var migration = ContainerCommands.Migration(directory, migrations, resources); await ContainerLifecycle.Owned(migration, source, stop.Token); stop.Token.ThrowIfCancellationRequested();
        Console.WriteLine("Public: " + config.PublicOrigin + "/\nManagement: " + config.PublicOrigin + "/manage/\nContent: " + config.ContentOrigin + "/"); await ContainerLifecycle.Owned(ContainerCommands.Server(directory, image, name, port, contentPort, resources), source, stop.Token);
    }
    private static T Parse<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new ArgumentException(value.Error.Message);
    private static int Port(string value) => int.TryParse(value, out var port) && port is >= 1024 and <= 65535 ? port : throw new ArgumentException("Port must be within 1024..65535");
    private static void Initialize(string directory, IReadOnlyDictionary<string, string> options)
    {
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any()) throw new IOException("Initialization requires an empty directory; existing data is never overwritten"); var username = options.GetValueOrDefault("administrator") ?? "";
        if (username.Length is < 1 or > 80 || username.Any(character => character is not (>= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or '=' or '-')) || username == "conduit" || username.StartsWith("crossfire-", StringComparison.Ordinal) || username.StartsWith("agent-", StringComparison.Ordinal)) throw new ArgumentException("Supply a regular human --administrator username");
        var configuration = WireJson.Object(writer => { foreach (var pair in new[] { ("instance", "instance"), ("serverName", "server-name"), ("publicOrigin", "origin"), ("contentOrigin", "content-origin") }) writer.WriteString(pair.Item1, options.GetValueOrDefault(pair.Item2)); writer.WriteString("matrixOrigin", "http://127.0.0.1:6167"); writer.WriteString("administrator", "@" + username + ":" + options.GetValueOrDefault("server-name")); writer.WriteString("jwtSecret", Identity.Secret()); writer.WriteString("registrationSecret", Identity.Secret()); }); var parsed = Parse(Configurations.Parse(configuration)); PrivateFiles.Directory(directory);
        PrivateFiles.Write(Path.Combine(directory, "config.json"), WireJson.Bytes(configuration, true), 65536); PrivateFiles.Write(Path.Combine(directory, "bootstrap.json"), WireJson.Bytes(WireJson.Object(writer => { writer.WriteString("servicePassword", Identity.Secret()); writer.WriteString("administratorPassword", Identity.Secret()); }), true), 16384); Console.WriteLine("Initialized " + directory + "\nAdministrator: " + parsed.Administrator + "\nInitial password: administratorPassword in " + Path.Combine(directory, "bootstrap.json"));
    }
    private static string ImageDigest(string source)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); var excluded = new HashSet<string>(["node_modules", "dist", "bin", "obj", "target", ".temp", ".analysis"], StringComparer.Ordinal);
        void File(string path) { hash.AppendData(Encoding.UTF8.GetBytes(Path.GetRelativePath(source, path))); using var input = System.IO.File.OpenRead(path); var buffer = new byte[65536]; int count; while ((count = input.Read(buffer)) != 0) hash.AppendData(buffer.AsSpan(0, count)); }
        void Tree(string directory) { foreach (var path in Directory.EnumerateFileSystemEntries(directory).Order(StringComparer.Ordinal)) { if (excluded.Contains(Path.GetFileName(path))) continue; var information = System.IO.File.GetAttributes(path); if ((information & FileAttributes.ReparsePoint) != 0) throw new IOException("Build input cannot be a symlink"); if ((information & FileAttributes.Directory) != 0) Tree(path); else File(path); } }
        foreach (var file in new[] { ".dockerignore", ".npmrc", "LICENSE", "package.json", "package-lock.json", "tsconfig.base.json", "global.json", "Directory.Build.props", "Directory.Build.targets", "Directory.Packages.props", "Crossfire.CSharp.slnx" }) File(Path.Combine(source, file)); foreach (var directory in new[] { "services", "scripts" }) Tree(Path.Combine(source, directory)); return Convert.ToHexStringLower(hash.GetHashAndReset())[..20];
    }
}
