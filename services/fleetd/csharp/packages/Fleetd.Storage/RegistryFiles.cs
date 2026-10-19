using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.Storage;

public sealed class RegistryFiles
{
    private readonly string root, operations;
    private readonly object gate = new();
    public FleetRegistry Port { get; }
    public RegistryFiles(string root)
    {
        if (PrivateFiles.Exists(root)) PrivateFiles.ExistingDirectory(root, true); else PrivateFiles.Directory(root); this.root = root;
        operations = PrivateFiles.Directory(Path.Combine(root, "operations")); var setup = new SetupFiles(root);
        Port = new(Registrations, values => Save("fleets.json", values, FleetWire.Registration, 1048576), Desired, SaveDesired, Selections, SaveSelections, Pending, Operation, SaveOperation, Prune, directory => ConfigurationFiles.Load(directory), ConfigurationFiles.WriteRoster, setup.Prepare, setup.Complete, setup.Retry);
    }
    private Result<IReadOnlyList<T>> Read<T>(string name, Func<JsonElement, Result<T>> parse, int limit, int maximum = 1048576) => ConfigurationFiles.Boundary(() =>
    { lock (gate) { var file = Path.Combine(root, name); return !PrivateFiles.Exists(file) ? Result<IReadOnlyList<T>>.Success([]) : Validation.List(WireJson.Parse(PrivateFiles.Read(file, maximum)), parse, limit); } });
    private Result<Unit> Save<T>(string name, IReadOnlyList<T> values, Func<T, JsonElement> encode, int maximum) => ConfigurationFiles.Boundary(() =>
    { lock (gate) PrivateFiles.Write(Path.Combine(root, name), WireJson.Bytes(WireJson.Array(writer => { foreach (var value in values) encode(value).WriteTo(writer); }), true), maximum); return Results.Done(); });
    private static Result<FleetRegistration> Registration(JsonElement value)
    {
        if (!Validation.Fields(value, ["fleetId", "fleetKey", "directory", "label", "revision", "digest"]).IsSuccess) return Results.Fail<FleetRegistration>("invalid", "Invalid fleet registration"); var id = WireJson.Text(value, "fleetId"); var key = WireJson.Text(value, "fleetKey"); var directory = Validation.Text(value.GetProperty("directory"), 4096); var label = Validation.Text(value.GetProperty("label"), 100); var revision = Validation.Integer(value.GetProperty("revision")); var digest = Validation.Text(value.GetProperty("digest"), 64, 64);
        return id is not null && Validation.Identifier(id) && key is not null && IdentitySyntax.Name(key) && directory.IsSuccess && label.IsSuccess && revision.IsSuccess && digest.IsSuccess && digest.Value.All(character => character is >= 'a' and <= 'f' or >= '0' and <= '9') ? Result<FleetRegistration>.Success(new(id, key, directory.Value, label.Value, revision.Value, digest.Value)) : Results.Fail<FleetRegistration>("invalid", "Invalid fleet registration identity or digest");
    }
    public Result<IReadOnlyList<FleetRegistration>> Registrations()
    { var values = Read("fleets.json", Registration, 100); return values.IsSuccess && (values.Value.Select(value => value.FleetId).Distinct().Count() != values.Value.Count || values.Value.Select(value => value.Directory).Distinct().Count() != values.Value.Count || values.Value.Select(value => value.FleetKey).Distinct().Count() != values.Value.Count) ? Results.Fail<IReadOnlyList<FleetRegistration>>("invalid", "Duplicate fleet registration identity, key or directory") : values; }
    public Result<IReadOnlyList<DesiredIntent>> Desired() => Read("desired-intent.json", value =>
    { if (!Validation.Fields(value, ["fleetId", "instanceKey"]).IsSuccess || WireJson.Text(value, "fleetId") is not { } fleet || !Validation.Identifier(fleet) || WireJson.Text(value, "instanceKey") is not { } key || !IdentitySyntax.Name(key)) return Results.Fail<DesiredIntent>("invalid", "Invalid desired fleet binding"); return Result<DesiredIntent>.Success(new(fleet, key)); }, 10000, 2097152).Bind(values => ValidDesired(values) ? Result<IReadOnlyList<DesiredIntent>>.Success(values) : Results.Fail<IReadOnlyList<DesiredIntent>>("invalid", "Duplicate or excessive desired bindings"));
    private static bool ValidDesired(IReadOnlyList<DesiredIntent> values) => values.Count <= 10000 && values.Select(value => (value.FleetId, value.InstanceKey)).Distinct().Count() == values.Count && values.GroupBy(value => value.FleetId).All(group => group.Count() <= 100) && values.Select(value => value.FleetId).Distinct().Count() <= 100;
    private Result<Unit> SaveDesired(IReadOnlyList<DesiredIntent> values) => ValidDesired(values) ? Save("desired-intent.json", values.OrderBy(value => value.FleetId, StringComparer.Ordinal).ThenBy(value => value.InstanceKey, StringComparer.Ordinal).ToArray(), value => WireJson.Object(writer => { writer.WriteString("fleetId", value.FleetId); writer.WriteString("instanceKey", value.InstanceKey); }), 2097152) : Results.Fail<Unit>("invalid", "Duplicate or excessive desired bindings");
    public Result<IReadOnlyList<ResumeSelection>> Selections() => Read("resume-selections.json", value =>
    {
        if (!Validation.Fields(value, ["fleetId", "instanceKeys"]).IsSuccess || WireJson.Text(value, "fleetId") is not { } id || !Validation.Identifier(id)) return Results.Fail<ResumeSelection>("invalid", "Invalid saved resume selection"); var keys = Validation.List(value.GetProperty("instanceKeys"), key => Validation.Text(key, 40).Bind(text => IdentitySyntax.Name(text) ? Result<string>.Success(text) : Results.Fail<string>("invalid", "Invalid saved resume instance")), 100);
        return keys.IsSuccess && keys.Value.Distinct().Count() == keys.Value.Count ? Result<ResumeSelection>.Success(new(id, keys.Value.Order(StringComparer.Ordinal).ToArray())) : Results.Fail<ResumeSelection>("invalid", "Duplicate saved resume instance");
    }, 100).Bind(values => values.Select(value => value.FleetId).Distinct().Count() == values.Count ? Result<IReadOnlyList<ResumeSelection>>.Success(values) : Results.Fail<IReadOnlyList<ResumeSelection>>("invalid", "Duplicate saved fleet resume selection"));
    private Result<Unit> SaveSelections(IReadOnlyList<ResumeSelection> values) => Save("resume-selections.json", values.OrderBy(value => value.FleetId, StringComparer.Ordinal).ToArray(), value => WireJson.Object(writer => { writer.WriteString("fleetId", value.FleetId); writer.WriteStartArray("instanceKeys"); foreach (var key in value.InstanceKeys.Order(StringComparer.Ordinal)) writer.WriteStringValue(key); writer.WriteEndArray(); }), 1048576);
    public Result<FleetOperation?> Operation(string id) => ConfigurationFiles.Boundary(() =>
    { if (!Validation.Identifier(id)) return Results.Fail<FleetOperation?>("invalid", "Invalid operation identity"); var file = Path.Combine(operations, id + ".json"); if (!PrivateFiles.Exists(file)) return Result<FleetOperation?>.Success(null); var parsed = OperationContract.Parse(WireJson.Parse(PrivateFiles.Read(file, 1048576))); return parsed.IsSuccess && parsed.Value.Request.OperationId != id ? Results.Fail<FleetOperation?>("invalid", "Operation file identity mismatch") : parsed.Map<FleetOperation?>(value => value); });
    private Result<Unit> SaveOperation(FleetOperation value) => ConfigurationFiles.Boundary(() =>
    { var wire = FleetWire.Operation(value); var parsed = OperationContract.Parse(wire); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error); lock (gate) PrivateFiles.Write(Path.Combine(operations, value.Request.OperationId + ".json"), WireJson.Bytes(wire, true), 1048576); return Results.Done(); });
    private IReadOnlyList<string> Files()
    {
        var result = new List<string>(); foreach (var path in Directory.EnumerateFileSystemEntries(operations)) { var name = Path.GetFileName(path); if (name.StartsWith(".pending-", StringComparison.Ordinal) && Validation.Identifier(name[9..])) { PrivateFiles.DeletePrivate(path); continue; } if (!name.EndsWith(".json", StringComparison.Ordinal) || !Validation.Identifier(name[..^5])) throw new InvalidDataException("Unexpected file in private operation storage"); result.Add(name[..^5]); } return result;
    }
    private Result<IReadOnlyList<FleetOperation>> Pending() => ConfigurationFiles.Boundary(() =>
    { lock (gate) { var values = new List<FleetOperation>(); foreach (var id in Files()) { var result = Operation(id); if (!result.IsSuccess) return Result<IReadOnlyList<FleetOperation>>.Fail(result.Error); if (result.Value is null) return Results.Fail<IReadOnlyList<FleetOperation>>("unavailable", "Operation disappeared during inspection"); if (result.Value.CompletedAt is null || result.Value.ReceiptPending) values.Add(result.Value); } return Result<IReadOnlyList<FleetOperation>>.Success(values); } });
    private Result<bool> Prune(long cutoff, int limit) => ConfigurationFiles.Boundary(() =>
    {
        if (limit is < 1 or > 1000) return Results.Fail<bool>("invalid", "Invalid operation retention boundary"); var removed = 0;
        lock (gate) foreach (var id in Files()) { var result = Operation(id); if (!result.IsSuccess) return Result<bool>.Fail(result.Error); if (result.Value is null) return Results.Fail<bool>("unavailable", "Operation disappeared during cleanup"); if (result.Value.CompletedAt is not null && !result.Value.ReceiptPending && result.Value.CompletedAt < cutoff) { PrivateFiles.DeletePrivate(Path.Combine(operations, id + ".json")); if (++removed >= limit) return Result<bool>.Success(true); } } return Result<bool>.Success(false);
    });
    public static Result<int> LoggingDays(string root) => ConfigurationFiles.Boundary(() =>
    { var path = Path.Combine(root, "config.json"); if (!PrivateFiles.Exists(path)) return Result<int>.Success(7); var value = WireJson.Parse(PrivateFiles.Read(path, 1048576)); if (!Validation.Fields(value, [], ["loggingRetentionDays"]).IsSuccess) return Results.Fail<int>("invalid", "Invalid controller logging configuration"); return value.TryGetProperty("loggingRetentionDays", out var days) ? Validation.Integer(days, 1, 104249991).Map(value => (int)value) : Result<int>.Success(7); });
}
