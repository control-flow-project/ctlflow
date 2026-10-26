using Crossfire.AdapterFilesystem;
using Crossfire.AdapterMatrix;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.Server;

public static class ServerOperator
{
    public static Task Run(string[] arguments)
    {
        if (arguments.Length == 0 || arguments is ["--help"]) { Console.WriteLine("crossfire init --directory DIR --instance NAME --origin URL --content-origin URL --server-name HOST --administrator USERNAME\nInitializes private configuration only. Use Docker Compose with the matching one-shot migration image for deployment."); return Task.CompletedTask; }
        if (arguments[0] != "init") throw new ArgumentException("Use init or serve");
        string[] allowed = ["directory", "instance", "origin", "content-origin", "server-name", "administrator"];
        var options = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 1; index < arguments.Length; index++) { var key = arguments[index]; if (!key.StartsWith("--", StringComparison.Ordinal) || !allowed.Contains(key[2..], StringComparer.Ordinal)) throw new ArgumentException("Invalid option " + key); var value = index + 1 < arguments.Length ? arguments[++index] : throw new ArgumentException("Missing value for " + key); if (!options.TryAdd(key[2..], value) || value.Length == 0) throw new ArgumentException("Duplicated or empty option " + key); }
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("The C# configuration command requires Linux");
        var directory = Path.GetFullPath(options.GetValueOrDefault("directory") ?? throw new ArgumentException("Supply --directory"));
        Initialize(directory, options);
        return Task.CompletedTask;
    }
    private static T Parse<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new ArgumentException(value.Error.Message);
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
