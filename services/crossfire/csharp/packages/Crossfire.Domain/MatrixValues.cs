namespace Crossfire.Domain;

public sealed record MatrixAccount(string UserId, string AccessToken, string DeviceId);
public sealed record NativePermission(string Action, long Level);
public sealed record RoomFacts(string RoomId, string Name, string Topic, string? Alias, string MatrixUserId,
    bool Creator, long? PowerLevel, IReadOnlyList<string> CreatorIds, long ReadLevel, long ReplyLevel,
    long InviteLevel, long KickLevel, long ChangePowerLevel, IReadOnlyList<NativePermission> NativePermissions);
public sealed record RoomMembership(string MatrixUserId, string DisplayName, string Membership, bool Creator, long? PowerLevel);
