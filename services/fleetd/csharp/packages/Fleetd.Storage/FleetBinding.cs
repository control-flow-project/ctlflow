using Crossfire.Domain;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Storage;

public sealed record BoundIdentity(string InstanceKey, string Name, string AgentId, BackendAccount Account);
public sealed record EnrollmentClaim(string EnrollmentId, string ClaimSecret, string Digest);
public sealed record FleetBinding(string Server, string Owner, string FleetKey, string? FleetId, string? ControllerCredential, EnrollmentClaim? Request, IReadOnlyList<BoundIdentity> Identities);
public static class BindingFiles
{
    public static Result<FleetBinding> Load(FleetConfiguration configuration) => ConfigurationFiles.Boundary(() =>
    {
        var file = Path.Combine(configuration.Directory, ".fleet", "binding.json"); var selected = configuration.Roster; if (!PrivateFiles.Exists(file)) return Result<FleetBinding>.Success(new(selected.Coordination.Server, selected.Coordination.Owner, selected.Fleet, null, null, null, []));
        var value = WireJson.Parse(PrivateFiles.Read(file, 1048576)); if (!Validation.Fields(value, ["server", "owner", "fleetKey", "fleetId", "controllerCredential", "request", "identities"]).IsSuccess) return Results.Fail<FleetBinding>("invalid", "Invalid private fleet binding");
        var server = WireJson.Text(value, "server"); var owner = WireJson.Text(value, "owner"); var key = WireJson.Text(value, "fleetKey"); var fleet = Validation.NullableText(value.GetProperty("fleetId")); var credential = Validation.NullableText(value.GetProperty("controllerCredential"), 200);
        if (server is null || !Validation.Origin(server).IsSuccess || owner is null || !Validation.UserId(owner) || key is null || !IdentitySyntax.Name(key) || !fleet.IsSuccess || fleet.Value is not null && !Validation.Identifier(fleet.Value) || !credential.IsSuccess) return Results.Fail<FleetBinding>("invalid", "Invalid fleet binding authority");
        EnrollmentClaim? claim = null; var request = value.GetProperty("request");
        if (request.ValueKind != JsonValueKind.Null) { if (!Validation.Fields(request, ["enrollmentId", "claimSecret", "digest"]).IsSuccess || WireJson.Text(request, "enrollmentId") is not { } enrollment || !Validation.Identifier(enrollment) || WireJson.Text(request, "claimSecret") is not { Length: 43 } secret || secret.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('_' or '-')) || WireJson.Text(request, "digest") is not { Length: 64 } digest || digest.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9'))) return Results.Fail<FleetBinding>("invalid", "Invalid retained enrollment claim"); claim = new(enrollment, secret, digest); }
        var identities = Validation.List(value.GetProperty("identities"), Identity, 100); if (!identities.IsSuccess || identities.Value.Select(identity => identity.InstanceKey).Distinct(StringComparer.Ordinal).Count() != identities.Value.Count || identities.Value.Select(identity => identity.AgentId).Distinct(StringComparer.Ordinal).Count() != identities.Value.Count) return Results.Fail<FleetBinding>("invalid", "Invalid or duplicate enrolled identities");
        return Result<FleetBinding>.Success(new(server, owner, key, fleet.Value, credential.Value, claim, identities.Value));
    });
    public static Result<BoundIdentity> Identity(JsonElement value)
    {
        if (!Validation.Fields(value, ["instanceKey", "name", "agentId", "account"]).IsSuccess) return Results.Fail<BoundIdentity>("invalid", "Invalid enrolled identity");
        var key = WireJson.Text(value, "instanceKey"); var name = WireJson.Text(value, "name"); var agent = WireJson.Text(value, "agentId"); var account = MessagingContract.Account(value.GetProperty("account"));
        return key is not null && IdentitySyntax.Name(key) && name is not null && IdentitySyntax.Name(name) && agent is not null && Validation.Identifier(agent) && account.IsSuccess ? Result<BoundIdentity>.Success(new(key, name, agent, account.Value)) : Results.Fail<BoundIdentity>("invalid", "Invalid immutable enrolled identity or account");
    }
    public static Result<Unit> Save(string directory, FleetBinding value) => ConfigurationFiles.Boundary(() =>
    {
        PrivateFiles.Write(Path.Combine(directory, ".fleet", "binding.json"), WireJson.Bytes(WireJson.Object(writer =>
        {
            writer.WriteString("server", value.Server); writer.WriteString("owner", value.Owner); writer.WriteString("fleetKey", value.FleetKey); writer.WriteString("fleetId", value.FleetId); writer.WriteString("controllerCredential", value.ControllerCredential); writer.WritePropertyName("request");
            if (value.Request is null) writer.WriteNullValue(); else { writer.WriteStartObject(); writer.WriteString("enrollmentId", value.Request.EnrollmentId); writer.WriteString("claimSecret", value.Request.ClaimSecret); writer.WriteString("digest", value.Request.Digest); writer.WriteEndObject(); }
            writer.WriteStartArray("identities"); foreach (var identity in value.Identities) { writer.WriteStartObject(); writer.WriteString("instanceKey", identity.InstanceKey); writer.WriteString("name", identity.Name); writer.WriteString("agentId", identity.AgentId); writer.WritePropertyName("account"); MessagingContract.Account(identity.Account).WriteTo(writer); writer.WriteEndObject(); } writer.WriteEndArray();
        }), true), 1048576); return Results.Done();
    });
    public static void InitializeHistory(string directory, string agent, string? reset)
    { if (!Validation.Identifier(agent) || reset is not null && !Validation.Identifier(reset)) throw new InvalidDataException("Invalid history initialization identity"); PrivateFiles.Write(HistoryFile(directory, agent), WireJson.Bytes(WireJson.Object(writer => { writer.WriteString("agentId", agent); writer.WriteString("resetId", reset); }), true), 1048576); }
    private static string HistoryFile(string directory, string agent) => Path.Combine(directory, ".fleet", "history-initialization", agent + ".json");
    public static bool CanInitialize(string directory, string agent)
    {
        var file = HistoryFile(directory, agent); if (!PrivateFiles.Exists(file)) return false; var value = WireJson.Parse(PrivateFiles.Read(file, 1048576)); if (!Validation.Fields(value, ["agentId", "resetId"]).IsSuccess || WireJson.Text(value, "agentId") != agent || !Validation.NullableText(value.GetProperty("resetId")).IsSuccess) throw new InvalidDataException("History initialization does not match its enrolled identity"); return true;
    }
    public static void Initialized(string directory, string agent) { if (CanInitialize(directory, agent)) PrivateFiles.DeletePrivate(HistoryFile(directory, agent)); }
}
