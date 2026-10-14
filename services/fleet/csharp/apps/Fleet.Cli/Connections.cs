using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleet.SshTransport;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public sealed record RemoteConnection(string Name, string Ssh, string Root);
public sealed record ConnectionSettings(string? LocalRoot, IReadOnlyList<RemoteConnection> Remotes);
public sealed record ProjectSetup(string Workspace, string Descriptor, string Root, string? Configuration);
public static class Connections
{
    public static string Home => Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    private static string ConfigurationRoot
    {
        get { var root = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") ?? Path.Combine(Home, ".config"); if (!Path.IsPathFullyQualified(root)) throw new CommandFailure("XDG_CONFIG_HOME must be absolute"); return Path.Combine(root, "fleet"); }
    }
    private static string SettingsFile => Path.Combine(ConfigurationRoot, "connections.json");
    private static JsonElement Read(string file) => WireJson.Parse(PrivateFiles.Read(file, 1048576));
    private static void Write(string file, JsonElement value) => PrivateFiles.Write(file, Encoding.UTF8.GetBytes(WireJson.Pretty(value)), 1048576);
    public static ConnectionSettings Load()
    {
        if (!PrivateFiles.Exists(SettingsFile)) return new(null, []); var value = Read(SettingsFile); Value(Validation.Fields(value, ["localRoot", "remotes"])); var root = WireJson.Text(value, "localRoot");
        if (root is null && value.GetProperty("localRoot").ValueKind != JsonValueKind.Null || root is not null && (!Path.IsPathFullyQualified(root) || root != Path.GetFullPath(root) || root.Any(char.IsControl))) throw new CommandFailure("Invalid saved local controller root"); var source = value.GetProperty("remotes"); if (source.ValueKind != JsonValueKind.Array || source.GetArrayLength() > 100) throw new CommandFailure("Invalid saved remote connections");
        var remotes = new List<RemoteConnection>(); var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in source.EnumerateArray()) { Value(Validation.Fields(item, ["name", "ssh", "root"])); var name = Name(Text(item, "name")); var ssh = Text(item, "ssh"); var remoteRoot = Text(item, "root"); if (!names.Add(name) || !SshTunnel.ValidHost(ssh) || !ValidRemoteRoot(remoteRoot)) throw new CommandFailure("Invalid saved remote identity or controller root"); remotes.Add(new(name, ssh, remoteRoot)); }
        return new(root, remotes);
    }
    public static bool ValidRemoteRoot(string root) => Path.IsPathFullyQualified(root) && root == Path.GetFullPath(root) && !root.Contains(':') && !root.Any(char.IsControl);
    public static void Save(ConnectionSettings settings) => Write(SettingsFile, Object(writer => { writer.WriteString("localRoot", settings.LocalRoot); writer.WriteStartArray("remotes"); foreach (var remote in settings.Remotes) { writer.WriteStartObject(); writer.WriteString("name", remote.Name); writer.WriteString("ssh", remote.Ssh); writer.WriteString("root", remote.Root); writer.WriteEndObject(); } writer.WriteEndArray(); }));
    private static string ProjectFile(string workspace) => Path.Combine(ConfigurationRoot, "projects", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(workspace))) + ".json");
    public static ProjectSetup? LoadProject(string workspace)
    {
        var file = ProjectFile(workspace); if (!PrivateFiles.Exists(file)) return null; var value = Read(file); Value(Validation.Fields(value, ["workspace", "descriptor", "root"], ["configuration"])); var configuration = WireJson.Text(value, "configuration"); var root = Text(value, "root"); var storedWorkspace = Text(value, "workspace");
        if (storedWorkspace != workspace || !Path.IsPathFullyQualified(root) || root != Path.GetFullPath(root) || root.Any(char.IsControl) || value.TryGetProperty("configuration", out _) && (configuration is null || !Path.IsPathFullyQualified(configuration) || configuration != Path.GetFullPath(configuration) || Path.GetFileName(configuration) != "runtime.toml") || !Uri.TryCreate(Text(value, "descriptor"), UriKind.Absolute, out var descriptor) || descriptor.UserInfo.Length != 0 || descriptor.Fragment.Length != 0 || descriptor.AbsolutePath != "/onboarding/setup.json" || !Validation.Origin(descriptor.GetLeftPart(UriPartial.Authority)).IsSuccess) throw new CommandFailure("Invalid saved project setup"); return new(storedWorkspace, descriptor.AbsoluteUri, root, configuration);
    }
    public static void SaveProject(ProjectSetup setup) => Write(ProjectFile(setup.Workspace), Object(writer => { writer.WriteString("workspace", setup.Workspace); writer.WriteString("descriptor", setup.Descriptor); writer.WriteString("root", setup.Root); if (setup.Configuration is not null) writer.WriteString("configuration", setup.Configuration); }));
}
