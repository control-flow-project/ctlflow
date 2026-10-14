using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record Coordination(string Origin, Func<RestCall, CancellationToken, ValueTask<Result<JsonElement>>> Call)
{
    public ValueTask<Result<JsonElement>> Agent(string operation, string agent, JsonElement? body, CancellationToken cancellation, IReadOnlyDictionary<string, string>? additional = null, IReadOnlyDictionary<string, string>? query = null)
    { var parameters = new Dictionary<string, string>(additional ?? new Dictionary<string, string>(), StringComparer.Ordinal) { ["agentId"] = agent }; return Call(new(operation, parameters, body, query), cancellation); }
}
public sealed record DeliveryRoom(string RoomId, string AccessMode, long? PowerLevel, bool Muted);
public sealed record ListenerPolicy(string AgentId, string MatrixUserId, string OwnerMatrixId, int MaxMessageBytes, int IdleTimeoutSeconds, string Status, string OwnerStatus,
    string? OwnerConversation, IReadOnlyList<DeliveryRoom> Rooms, string WakeMode, IReadOnlySet<string> Senders);

public static class CoordinationValues
{
    public static Result<ListenerPolicy> Policy(JsonElement value)
    {
        if (!Validation.Fields(value, ["agentId", "matrixUserId", "ownerMatrixId", "maxMessageBytes", "fleetIdleTimeoutSeconds", "status", "ownerStatus", "ownerConversation", "roomGrants", "wakeMode", "senderMatrixIds"]).IsSuccess) return Results.Fail<ListenerPolicy>("invalid", "Invalid delivery policy");
        var id = WireJson.Text(value, "agentId"); var self = WireJson.Text(value, "matrixUserId"); var owner = WireJson.Text(value, "ownerMatrixId"); var bytes = Validation.Integer(value.GetProperty("maxMessageBytes"), 4096, AgentIO.MaximumInputBytes); var idle = Validation.Integer(value.GetProperty("fleetIdleTimeoutSeconds"), 0, 604800);
        var status = Validation.Choice(value.GetProperty("status"), "active", "suspended", "revoked"); var ownerStatus = Validation.Choice(value.GetProperty("ownerStatus"), "active", "suspended", "revoked"); var mode = Validation.Choice(value.GetProperty("wakeMode"), "selected", "humans", "everyone");
        var conversation = Validation.NullableText(value.GetProperty("ownerConversation")); var senders = Validation.List(value.GetProperty("senderMatrixIds"), text => Validation.Text(text).Bind(user => Validation.UserId(user) ? Result<string>.Success(user) : Results.Fail<string>("invalid", "Invalid wake sender")), 2000);
        var rooms = Validation.List(value.GetProperty("roomGrants"), room =>
        {
            if (!Validation.Fields(room, ["roomId", "accessMode", "powerLevel", "muted"]).IsSuccess) return Results.Fail<DeliveryRoom>("invalid", "Invalid delivery room");
            var identity = WireJson.Text(room, "roomId"); var access = Validation.Choice(room.GetProperty("accessMode"), "read", "reply", "custom"); var power = Validation.NullableInteger(room.GetProperty("powerLevel"), -Validation.MaxWireInteger); var muted = Validation.Boolean(room.GetProperty("muted"));
            return identity is null || !Validation.RoomId(identity) || !access.IsSuccess || !power.IsSuccess || !muted.IsSuccess || (access.Value == "custom") != (power.Value is not null) ? Results.Fail<DeliveryRoom>("invalid", "Invalid delivery room authority") : Result<DeliveryRoom>.Success(new(identity, access.Value, power.Value, muted.Value));
        }, 101);
        if (id is null || !Validation.Identifier(id) || self is null || !Validation.UserId(self) || owner is null || !Validation.UserId(owner) || !bytes.IsSuccess || !idle.IsSuccess || !status.IsSuccess || !ownerStatus.IsSuccess || !mode.IsSuccess || !conversation.IsSuccess || conversation.Value is not null && !Validation.RoomId(conversation.Value)
            || !senders.IsSuccess || !rooms.IsSuccess || senders.Value.Contains(self, StringComparer.Ordinal) || senders.Value.Distinct(StringComparer.Ordinal).Count() != senders.Value.Count || rooms.Value.Select(room => room.RoomId).Distinct(StringComparer.Ordinal).Count() != rooms.Value.Count
            || conversation.Value is not null && !rooms.Value.Any(room => room.RoomId == conversation.Value && room.AccessMode == "reply" && !room.Muted) || (status.Value != "active" || ownerStatus.Value != "active") && senders.Value.Count != 0)
            return Results.Fail<ListenerPolicy>("invalid", "Invalid delivery authority or duplicate principals");
        return Result<ListenerPolicy>.Success(new(id, self, owner, (int)bytes.Value, (int)idle.Value, status.Value, ownerStatus.Value, conversation.Value, rooms.Value, mode.Value, senders.Value.ToHashSet(StringComparer.Ordinal)));
    }
    public static Result<PrincipalIdentity> Identity(JsonElement value)
    {
        if (!Validation.Fields(value, ["matrixUserId", "kind", "ownerMatrixId", "displayName", "ownerDisplayName"]).IsSuccess) return Results.Fail<PrincipalIdentity>("invalid", "Invalid resolved principal");
        var id = WireJson.Text(value, "matrixUserId"); var kind = Validation.Choice(value.GetProperty("kind"), "human", "agent", "unknown"); var owner = Validation.NullableText(value.GetProperty("ownerMatrixId")); var name = Validation.NullableText(value.GetProperty("displayName")); var ownerName = Validation.NullableText(value.GetProperty("ownerDisplayName"));
        return id is null || !Validation.UserId(id) || !kind.IsSuccess || !owner.IsSuccess || owner.Value is not null && !Validation.UserId(owner.Value) || !name.IsSuccess || !ownerName.IsSuccess || (kind.Value == "agent") != (owner.Value is not null)
            ? Results.Fail<PrincipalIdentity>("invalid", "Invalid resolved principal kind or owner") : Result<PrincipalIdentity>.Success(new(id, kind.Value, owner.Value, name.Value, ownerName.Value));
    }
    public static JsonElement Encode(PrincipalIdentity value) => WireJson.Object(writer => { writer.WriteString("matrixUserId", value.MatrixUserId); writer.WriteString("kind", value.Kind); writer.WriteString("ownerMatrixId", value.OwnerMatrixId); writer.WriteString("displayName", value.DisplayName); writer.WriteString("ownerDisplayName", value.OwnerDisplayName); });
    public static async ValueTask<Result<IReadOnlyDictionary<string, PrincipalIdentity>>> Senders(Coordination coordination, IReadOnlyList<ReceivedEvent> events, CancellationToken cancellation)
    {
        var ids = events.Select(value => value.Sender).Distinct(StringComparer.Ordinal).ToArray(); var result = new Dictionary<string, PrincipalIdentity>(StringComparer.Ordinal);
        for (var position = 0; position < ids.Length; position += 100)
        {
            var requested = ids.Skip(position).Take(100).ToHashSet(StringComparer.Ordinal); var input = WireJson.Object(writer => { writer.WriteStartArray("matrixUserIds"); foreach (var id in requested) writer.WriteStringValue(id); writer.WriteEndArray(); });
            var response = await coordination.Call(new("resolvePrincipals", new Dictionary<string, string>(), input), cancellation); if (!response.IsSuccess) return Result<IReadOnlyDictionary<string, PrincipalIdentity>>.Fail(response.Error);
            var parsed = Validation.List(response.Value, Identity, 100, 1); if (!parsed.IsSuccess || parsed.Value.Count != requested.Count || parsed.Value.Any(value => !requested.Contains(value.MatrixUserId)) || parsed.Value.Select(value => value.MatrixUserId).Distinct(StringComparer.Ordinal).Count() != requested.Count)
                return Results.Fail<IReadOnlyDictionary<string, PrincipalIdentity>>("invalid", "Sender identity response does not match the exact requested identities");
            foreach (var value in parsed.Value) result.Add(value.MatrixUserId, value);
        }
        return Result<IReadOnlyDictionary<string, PrincipalIdentity>>.Success(result);
    }
}
