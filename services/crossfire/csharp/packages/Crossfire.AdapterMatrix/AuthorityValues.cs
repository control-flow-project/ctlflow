using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed record NativePermission(string Action, long Level);
public sealed record MatrixRoomFacts(string RoomId, string Name, string Topic, string? Alias, string BackendUserId,
    bool Creator, long? PowerLevel, IReadOnlyList<string> CreatorIds, long ReadLevel, long ReplyLevel,
    long InviteLevel, long KickLevel, long ChangePowerLevel, IReadOnlyList<NativePermission> NativePermissions);
public sealed record MatrixMembership(string BackendUserId, string DisplayName, string Membership, bool Creator, long? PowerLevel);
public sealed record MatrixAccess(string Mode, long PowerLevel);

public static class AuthorityValues
{
    public static Result<long> RequestedPower(MatrixRoomFacts facts, string target, RoomAccessIntent intent, bool reconcile = false)
    {
        if (facts.CreatorIds.Contains(target, StringComparer.Ordinal) && intent.AccessMode != "reply")
            return Results.Fail<long>("forbidden", "Matrix creator authority cannot be restricted by an agent grant");
        long? custom = null;
        if (intent.AccessMode == "custom")
        {
            if (intent.NativeAccess is not { ValueKind: JsonValueKind.Object } native || native.EnumerateObject().Count() != 1
                || !native.TryGetProperty("powerLevel", out var level) || level.ValueKind != JsonValueKind.Number
                || !level.TryGetDouble(out var value) || !double.IsFinite(value) || value != Math.Truncate(value)
                || value < -9007199254740991L || value > 9007199254740991L)
                return Results.Fail<long>("invalid", "Matrix custom access requires one finite integer powerLevel parameter");
            custom = (long)value;
        }
        else if (intent.NativeAccess is not null) return Results.Fail<long>("invalid", "Only custom access accepts native parameters");
        var requested = intent.AccessMode == "read" ? facts.ReadLevel : intent.AccessMode == "reply" ? facts.ReplyLevel : custom;
        if (requested is null || requested < -9007199254740991L || requested > 9007199254740991L) return Results.Fail<long>("invalid", "Unsupported Matrix room access");
        if (reconcile && intent.AccessMode == "custom" && !facts.Creator) requested = Math.Min(requested.Value, facts.PowerLevel!.Value);
        return facts.Creator || requested <= facts.PowerLevel ? Result<long>.Success(requested.Value)
            : Results.Fail<long>("forbidden", "Requested access exceeds the authorizer’s Matrix room permissions");
    }

    public static RoomFacts View(MatrixRoomFacts facts, string? target = null)
    {
        var maximum = facts.Creator ? 9007199254740991L : facts.PowerLevel!.Value;
        var permissions = facts.NativePermissions.OrderBy(value => value.Action, StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("en-US"), false)).ToArray();
        var revision = Identity.Hash(WireJson.Compact(WireJson.Object(writer =>
        {
            writer.WriteBoolean("creator", facts.Creator); if (facts.PowerLevel is { } level) writer.WriteNumber("level", level); else writer.WriteNull("level");
            writer.WriteStartArray("creators"); foreach (var creator in facts.CreatorIds.Order(StringComparer.Ordinal)) writer.WriteStringValue(creator); writer.WriteEndArray();
            writer.WriteNumber("read", facts.ReadLevel); writer.WriteNumber("reply", facts.ReplyLevel); writer.WriteNumber("invite", facts.InviteLevel);
            writer.WriteStartArray("permissions"); foreach (var permission in permissions) { writer.WriteStartObject(); writer.WriteString("action", permission.Action); writer.WriteNumber("level", permission.Level); writer.WriteEndObject(); } writer.WriteEndArray();
        })));
        IReadOnlyList<string> modes = target is not null && facts.CreatorIds.Contains(target, StringComparer.Ordinal) ? ["reply"]
            : facts.Creator || facts.ReplyLevel <= maximum ? ["read", "reply", "custom"] : ["read", "custom"];
        return new(facts.RoomId, facts.Name, facts.Topic, facts.Alias, facts.BackendUserId, facts.Creator || facts.PowerLevel >= facts.InviteLevel,
            modes, revision, [new("powerLevel", "Matrix power level", -9007199254740991L, maximum, Math.Min(0, maximum))],
            permissions.Select(value => new BackendPermission(value.Action, value.Action + " · required level " + value.Level.ToString(System.Globalization.CultureInfo.InvariantCulture), facts.Creator || value.Level <= facts.PowerLevel)).ToArray());
    }
    public static RoomMembership View(MatrixMembership member) => new(member.BackendUserId, member.DisplayName, member.Membership,
        WireJson.Object(writer => { writer.WriteBoolean("creator", member.Creator); if (member.PowerLevel is { } level) writer.WriteNumber("powerLevel", level); else writer.WriteNull("powerLevel"); }));
}
