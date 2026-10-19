using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Contracts;

public static class FleetConfigurationContract
{
    public static Result<FleetInstance> Instance(JsonElement value, bool toml = true)
    {
        var runtime = toml ? "runtime_options" : "runtimeOptions"; var listener = toml ? "listener_options" : "listenerOptions"; var history = toml ? "history_mode" : "historyMode";
        if (!Validation.Fields(value, ["key", "name", "definition", "workarea"], ["workspace", runtime, listener]).IsSuccess) return Results.Fail<FleetInstance>("invalid", "Invalid fleet instance fields");
        var key = WireJson.Text(value, "key"); var name = WireJson.Text(value, "name"); var definition = WireJson.Text(value, "definition"); var workarea = WireJson.Text(value, "workarea"); var workspace = WireJson.Text(value, "workspace");
        if (key is null || !IdentitySyntax.Name(key) || name is null || !IdentitySyntax.Name(name) || definition is null || !IdentitySyntax.Name(definition) || workarea is null || workarea.Length > 1024 || !Relative(workarea) || value.TryGetProperty("workspace", out _) && (workspace is null || !Absolute(workspace))) return Results.Fail<FleetInstance>("invalid", "Invalid instance name or normalized workspace/workarea");
        var parts = workarea.Split('/'); if (parts.Length < 4 || parts[0] != "agents" || !IdentitySyntax.Name(parts[1]) || parts[2] != "workarea") return Results.Fail<FleetInstance>("invalid", "Work areas must be relative children of agents/<definition>/workarea");
        JsonElement? options = null; if (value.TryGetProperty(runtime, out var native)) { if (native.ValueKind != JsonValueKind.Object || !Validation.Json(native)) return Results.Fail<FleetInstance>("invalid", "Expected JSON runtime options"); options = native.Clone(); }
        var mode = NativeHistoryMode.Shared;
        if (value.TryGetProperty(listener, out var receiver))
        {
            if (!Validation.Fields(receiver, [], [history]).IsSuccess) return Results.Fail<FleetInstance>("invalid", "Invalid listener options");
            if (receiver.TryGetProperty(history, out var selected)) { var parsed = Validation.Choice(selected, "shared", "per-room"); if (!parsed.IsSuccess) return Result<FleetInstance>.Fail(parsed.Error); mode = parsed.Value == "shared" ? NativeHistoryMode.Shared : NativeHistoryMode.PerRoom; }
        }
        return Result<FleetInstance>.Success(new(key, name, definition, workarea, workspace, options, mode));
    }
    public static Result<FleetRoster> Roster(JsonElement value)
    {
        if (!Validation.Fields(value, ["fleet", "coordination", "instances"]).IsSuccess || !Validation.Fields(value.GetProperty("coordination"), ["adapter", "server", "owner"]).IsSuccess) return Results.Fail<FleetRoster>("invalid", "Invalid fleet roster fields");
        var fleet = WireJson.Text(value, "fleet"); var coordination = value.GetProperty("coordination"); var server = WireJson.Text(coordination, "server"); var owner = WireJson.Text(coordination, "owner"); var instances = Validation.List(value.GetProperty("instances"), source => Instance(source), 100);
        if (fleet is null || !IdentitySyntax.Name(fleet) || WireJson.Text(coordination, "adapter") != "crossfire" || server is null || !Validation.Origin(server).IsSuccess || owner is null || !Validation.UserId(owner) || !instances.IsSuccess) return Results.Fail<FleetRoster>("invalid", "Invalid fleet identity, coordination origin, owner or instances");
        if (instances.Value.Select(instance => instance.Key).Distinct(StringComparer.Ordinal).Count() != instances.Value.Count || instances.Value.Select(instance => instance.Name).Distinct(StringComparer.Ordinal).Count() != instances.Value.Count || instances.Value.Select(instance => instance.Workarea).Distinct(StringComparer.Ordinal).Count() != instances.Value.Count) return Results.Fail<FleetRoster>("name_collision", "Instance keys, agent names and workareas must be unique within a fleet");
        if (instances.Value.Any(instance => instances.Value.Any(other => other != instance && other.Workarea.StartsWith(instance.Workarea + "/", StringComparison.Ordinal)))) return Results.Fail<FleetRoster>("invalid", "Instance work areas cannot overlap"); return Result<FleetRoster>.Success(new(fleet, new(server, owner), instances.Value));
    }
    public static Result<AgentDefinition> Definition(JsonElement value, string instructions, string owner)
    {
        if (!Validation.Fields(value, ["name", "runtime", "runtime_options"], ["coordination_options"]).IsSuccess) return Results.Fail<AgentDefinition>("invalid", "Invalid agent definition fields");
        var name = Validation.Text(value.GetProperty("name"), 100); var runtime = Validation.Choice(value.GetProperty("runtime"), "codex", "pi"); var options = value.GetProperty("runtime_options"); if (!name.IsSuccess || !runtime.IsSuccess || options.ValueKind != JsonValueKind.Object || !Validation.Json(options)) return Results.Fail<AgentDefinition>("invalid", "Invalid role name, supported runtime or native options");
        var policy = DefaultPolicy(owner);
        if (value.TryGetProperty("coordination_options", out var coordination))
        {
            if (!Validation.Fields(coordination, ["wake_mode", "wake_senders", "permissions"]).IsSuccess) return Results.Fail<AgentDefinition>("invalid", "Invalid coordination policy"); var mode = Validation.Choice(coordination.GetProperty("wake_mode"), "everyone", "humans", "selected"); var senders = coordination.GetProperty("wake_senders"); var permissions = Validation.List(coordination.GetProperty("permissions"), text => Validation.Choice(text, "room.agent.invite"), 1);
            if (!mode.IsSuccess || !permissions.IsSuccess || senders.ValueKind != JsonValueKind.Array || senders.GetArrayLength() > 2000 || mode.Value == "everyone" && senders.GetArrayLength() != 0) return Results.Fail<AgentDefinition>("invalid", "Invalid wake selection or agent invitation permissions"); var identities = new HashSet<string>(StringComparer.Ordinal);
            foreach (var sender in senders.EnumerateArray()) if (!Validation.Fields(sender, ["backend_user_id", "include_agents"]).IsSuccess || WireJson.Text(sender, "backend_user_id") is not { } identity || !Validation.UserId(identity) || !identities.Add(identity) || !Validation.Boolean(sender.GetProperty("include_agents")).IsSuccess) return Results.Fail<AgentDefinition>("invalid", "Invalid or duplicated wake identity");
            policy = WireJson.Object(writer => { writer.WriteString("wakeMode", mode.Value); writer.WriteStartArray("senders"); foreach (var sender in senders.EnumerateArray()) { writer.WriteStartObject(); writer.WriteString("backendUserId", WireJson.Text(sender, "backend_user_id")); writer.WriteBoolean("includeAgents", sender.GetProperty("include_agents").GetBoolean()); writer.WriteEndObject(); } writer.WriteEndArray(); writer.WriteStartArray("permissions"); foreach (var permission in permissions.Value) writer.WriteStringValue(permission); writer.WriteEndArray(); });
        }
        return Result<AgentDefinition>.Success(new(name.Value, runtime.Value, options.Clone(), instructions, policy));
    }
    public static JsonElement DefaultPolicy(string owner) => WireJson.Object(writer => { writer.WriteString("wakeMode", "selected"); writer.WriteStartArray("senders"); writer.WriteStartObject(); writer.WriteString("backendUserId", owner); writer.WriteBoolean("includeAgents", false); writer.WriteEndObject(); writer.WriteEndArray(); writer.WriteStartArray("permissions"); writer.WriteEndArray(); });
    public static bool Relative(string path) => path.Length != 0 && !path.StartsWith('/') && !path.Contains('\\') && path.Split('/').All(part => part.Length != 0 && part is not ("." or "..") && !part.StartsWith('.'));
    public static bool Absolute(string path) => path.StartsWith('/') && !path.Contains('\\') && path.Split('/').Skip(1).All(part => part.Length != 0 && part is not ("." or ".."));
}
