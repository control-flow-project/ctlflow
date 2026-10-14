namespace Crossfire.Domain;

public sealed record MatrixAccount(string UserId, string AccessToken, string DeviceId);
public sealed record NativePermission(string Action, long Level);
public sealed record RoomFacts(string RoomId, string Name, string Topic, string? Alias, string MatrixUserId,
    bool Creator, long? PowerLevel, IReadOnlyList<string> CreatorIds, long ReadLevel, long ReplyLevel,
    long InviteLevel, long KickLevel, long ChangePowerLevel, IReadOnlyList<NativePermission> NativePermissions);
public sealed record RoomMembership(string MatrixUserId, string DisplayName, string Membership, bool Creator, long? PowerLevel);
public sealed record NativeRoomAccess(string Mode, long PowerLevel);
public sealed record NativeRoomAdmission(string Kind, string? EventId = null, string? SenderMatrixId = null);
public sealed record NativeMatrixEvent(string EventId, string RoomId, string SenderMatrixId, string Type, string? MessageType,
    string? Body, IReadOnlyList<string> Mentions, bool Edited, bool Control);
