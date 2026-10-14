using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterToml;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.Storage;

public static class ConfigurationFiles
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    public static string Text(string file, int maximum = 1048576) => Utf8.GetString(PrivateFiles.ReadConfiguration(file, maximum));
    public static Result<T> Boundary<T>(Func<Result<T>> action)
    { try { return action(); } catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or OverflowException or KeyNotFoundException) { return Results.Fail<T>("invalid", error.Message); } }
    public static Result<FleetConfiguration> Load(string directory, string? replacement = null) => Boundary(() =>
    {
        PrivateFiles.OwnedDirectory(directory); var source = replacement ?? Text(Path.Combine(directory, "runtime.toml")); var parsed = TomlJson.Parse(source).Bind(FleetConfigurationContract.Roster); if (!parsed.IsSuccess) return Result<FleetConfiguration>.Fail(parsed.Error);
        var definitions = new Dictionary<string, AgentDefinition>(StringComparer.Ordinal); using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); void Append(string value) => hash.AppendData(Utf8.GetBytes(value)); Append(source);
        var extraPath = Path.Combine(directory, ".fleet", "setup-instructions.json"); var extra = "";
        if (PrivateFiles.Exists(extraPath)) { var value = WireJson.Parse(PrivateFiles.Read(extraPath, 262144)); if (!Validation.Fields(value, ["instructions"]).IsSuccess || !Validation.PlainText(value.GetProperty("instructions"), 131072).IsSuccess) return Results.Fail<FleetConfiguration>("invalid", "Invalid persisted setup instructions"); extra = WireJson.Text(value, "instructions")!; } Append(extra);
        foreach (var instance in parsed.Value.Instances)
        {
            if (!definitions.ContainsKey(instance.Definition))
            {
                var root = Path.Combine(directory, "agents", instance.Definition); PrivateFiles.OwnedDirectory(root); var roleText = Text(Path.Combine(root, "agent.toml")); var instructions = Text(Path.Combine(root, "AGENTS.md"), 131072); var role = TomlJson.Parse(roleText).Bind(value => FleetConfigurationContract.Definition(value, instructions + (extra.Length == 0 ? "" : "\n\n" + extra), parsed.Value.Coordination.Owner)); if (!role.IsSuccess) return Result<FleetConfiguration>.Fail(role.Error); definitions.Add(instance.Definition, role.Value); Append(instance.Definition); Append(roleText); Append(instructions);
            }
            if (instance.Workspace is not null) PrivateFiles.OwnedDirectory(instance.Workspace, true);
            var path = directory; foreach (var part in instance.Workarea.Split('/')) { path = Path.Combine(path, part); if (PrivateFiles.Exists(path)) PrivateFiles.OwnedDirectory(path); }
        }
        return Result<FleetConfiguration>.Success(new(directory, parsed.Value, definitions, Convert.ToHexStringLower(hash.GetHashAndReset())));
    });
    public static Result<FleetConfiguration> WriteRoster(FleetConfiguration configuration, FleetRoster roster) => Boundary(() =>
    {
        var wire = FleetWire.Roster(roster); var valid = FleetConfigurationContract.Roster(wire); if (!valid.IsSuccess) return Result<FleetConfiguration>.Fail(valid.Error); var current = Load(configuration.Directory); if (!current.IsSuccess) return current; if (current.Value.Digest != configuration.Digest) return Results.Fail<FleetConfiguration>("stale_revision", "Fleet files changed; refresh before editing");
        var text = TomlJson.Format(wire); if (!text.IsSuccess) return Result<FleetConfiguration>.Fail(text.Error); var candidate = Load(configuration.Directory, text.Value); if (!candidate.IsSuccess) return candidate;
        PrivateFiles.WriteConfiguration(Path.Combine(configuration.Directory, "runtime.toml"), Utf8.GetBytes(text.Value), 1048576); return Load(configuration.Directory);
    });
}
