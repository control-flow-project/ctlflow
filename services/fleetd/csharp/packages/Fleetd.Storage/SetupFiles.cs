using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterToml;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.Storage;

public sealed class SetupFiles(string root)
{
    private sealed record SetupRecord(string Directory, string OperationId, bool Completed, string Server, string Owner, string Workspace, string Instructions);
    private readonly object gate = new();
    private string File => Path.Combine(root, "setups.json");
    private List<SetupRecord> Read()
    {
        if (!PrivateFiles.Exists(File)) return []; var value = WireJson.Parse(PrivateFiles.Read(File, 2097152)); if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 1000) throw new InvalidDataException("Invalid private setup registry"); var result = new List<SetupRecord>();
        foreach (var row in value.EnumerateArray())
        {
            if (!Validation.Fields(row, ["directory", "operationId", "completed", "server", "owner", "workspace", "instructions"]).IsSuccess || WireJson.Text(row, "directory") is not { } directory || WireJson.Text(row, "operationId") is not { } id || !Validation.Identifier(id) || !Validation.Boolean(row.GetProperty("completed")).IsSuccess || WireJson.Text(row, "server") is not { } server || !Validation.Origin(server).IsSuccess || WireJson.Text(row, "owner") is not { } owner || !Validation.UserId(owner) || WireJson.Text(row, "workspace") is not { } workspace || !Validation.PlainText(row.GetProperty("instructions"), 131072).IsSuccess || result.Any(value => value.Directory == directory || value.OperationId == id)) throw new InvalidDataException("Invalid or duplicate saved setup authority");
            result.Add(new(directory, id, row.GetProperty("completed").GetBoolean(), server, owner, workspace, WireJson.Text(row, "instructions")!));
        }
        return result;
    }
    private void Save(IReadOnlyList<SetupRecord> values) => PrivateFiles.Write(File, WireJson.Bytes(WireJson.Array(writer => { foreach (var value in values) { writer.WriteStartObject(); writer.WriteString("directory", value.Directory); writer.WriteString("operationId", value.OperationId); writer.WriteBoolean("completed", value.Completed); writer.WriteString("server", value.Server); writer.WriteString("owner", value.Owner); writer.WriteString("workspace", value.Workspace); writer.WriteString("instructions", value.Instructions); writer.WriteEndObject(); } }), true), 2097152);
    public static string GeneratedName(string project, string identity)
    {
        var text = new StringBuilder(); var separator = false; foreach (var character in project.ToLowerInvariant()) { if (character is >= 'a' and <= 'z' or >= '0' and <= '9') { if (separator && text.Length != 0) text.Append('-'); separator = false; text.Append(character); } else separator = true; }
        var prefix = text.ToString(); if (prefix.Length == 0 || prefix[0] is < 'a' or > 'z') prefix = "project-" + prefix; prefix = prefix[..Math.Min(27, prefix.Length)].TrimEnd('-'); return prefix + "-" + identity[..12];
    }
    public Result<SetupConfiguration> Prepare(SetupRequest input) => ConfigurationFiles.Boundary(() =>
    {
        lock (gate)
        {
            PrivateFiles.OwnedDirectory(input.Workspace, true); var digest = Identity.Hash(WireJson.Compact(WireJson.Object(writer => { writer.WriteString("workspace", input.Workspace); writer.WriteString("server", input.Descriptor.Server); writer.WriteString("owner", input.Descriptor.OwnerBackendUserId); })));
            if (input.Configuration is not null && (!FleetConfigurationContract.Absolute(input.Configuration) || Path.GetFileName(input.Configuration) != "runtime.toml")) return Results.Fail<SetupConfiguration>("invalid", "Configuration must be an absolute runtime.toml path"); var directory = input.Configuration is null ? Path.Combine(root, "projects", digest) : Path.GetDirectoryName(input.Configuration)!;
            var values = Read(); var previous = values.FirstOrDefault(value => value.Directory == directory); if (previous is not null && (previous.Server != input.Descriptor.Server || previous.Owner != input.Descriptor.OwnerBackendUserId || previous.Workspace != input.Workspace)) return Results.Fail<SetupConfiguration>("conflict", "Saved setup authority or workspace differs; identities are never silently reassigned");
            if (input.Configuration is null && previous is null && !PrivateFiles.Exists(directory))
            {
                var projects = PrivateFiles.Directory(Path.Combine(root, "projects")); var staging = PrivateFiles.Directory(Path.Combine(projects, ".setup-" + Identity.Identifier())); var published = false;
                try
                {
                var role = PrivateFiles.Directory(Path.Combine(staging, "agents", "project")); var name = GeneratedName(Path.GetFileName(input.Workspace), digest);
                var roster = new FleetRoster(name, new(input.Descriptor.Server, input.Descriptor.OwnerBackendUserId), [new(name, name, "project", "agents/project/workarea/" + name, input.Workspace, null)]); var runtime = TomlJson.Format(FleetWire.Roster(roster)); if (!runtime.IsSuccess) return Result<SetupConfiguration>.Fail(runtime.Error); PrivateFiles.Write(Path.Combine(staging, "runtime.toml"), Encoding.UTF8.GetBytes(runtime.Value), 1048576);
                var definition = TomlJson.Format(WireJson.Object(writer => { writer.WriteString("name", TextRules.TruncateUtf16(Path.GetFileName(input.Workspace), 100)); writer.WriteString("runtime", "codex"); writer.WriteStartObject("runtime_options"); writer.WriteString("sandbox_mode", "danger-full-access"); writer.WriteString("approval_policy", "on-request"); writer.WriteBoolean("dangerously_bypass_approvals_and_sandbox", false); writer.WriteEndObject(); })); if (!definition.IsSuccess) return Result<SetupConfiguration>.Fail(definition.Error);
                PrivateFiles.Write(Path.Combine(role, "agent.toml"), Encoding.UTF8.GetBytes(definition.Value), 1048576); PrivateFiles.Write(Path.Combine(role, "AGENTS.md"), "Work in the configured project workspace. Follow its instructions and the authorized human requests. This is a separate fleet-managed agent; the coding session performing setup is not your conversation.\n"u8, 1048576); ManagedLinks.PublishDirectory(staging, directory); published = true;
                }
                finally { if (!published) System.IO.Directory.Delete(staging, recursive: true); }
            }
            var loaded = ConfigurationFiles.Load(directory); if (!loaded.IsSuccess) return Result<SetupConfiguration>.Fail(loaded.Error); if (loaded.Value.Roster.Coordination.Server != input.Descriptor.Server || loaded.Value.Roster.Coordination.Owner != input.Descriptor.OwnerBackendUserId) return Results.Fail<SetupConfiguration>("conflict", "Configuration authority must match the verified setup descriptor"); if (loaded.Value.Roster.Instances.Count == 0) return Results.Fail<SetupConfiguration>("invalid", "Setup requires at least one configured agent");
            var record = previous ?? new(directory, Identity.Identifier(), false, input.Descriptor.Server, input.Descriptor.OwnerBackendUserId, input.Workspace, input.Descriptor.Instructions); if (previous is null) { if (values.Count >= 1000) return Results.Fail<SetupConfiguration>("capacity", "Private setup registry is full"); values.Add(record); Save(values); }
            PrivateFiles.Write(Path.Combine(directory, ".fleet", "setup-instructions.json"), WireJson.Bytes(WireJson.Object(writer => writer.WriteString("instructions", record.Instructions)), true), 262144); var configuration = ConfigurationFiles.Load(directory); return configuration.Map(value => new SetupConfiguration(value, record.OperationId, record.Completed));
        }
    });
    public Result<Unit> Complete(string id) => ConfigurationFiles.Boundary(() => { lock (gate) { var values = Read(); var index = values.FindIndex(value => value.OperationId == id); if (index >= 0 && !values[index].Completed) { values[index] = values[index] with { Completed = true }; Save(values); } return Results.Done(); } });
    public Result<Unit> Retry(string previousId, string id) => ConfigurationFiles.Boundary(() => { lock (gate) { var values = Read(); var index = values.FindIndex(value => value.OperationId == previousId && !value.Completed); if (index < 0 || !Validation.Identifier(id)) return Results.Fail<Unit>("conflict", "Only an incomplete setup can retry its initial operation"); values[index] = values[index] with { OperationId = id }; Save(values); return Results.Done(); } });
}
