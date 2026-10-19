using System.Text.Json;

namespace Crossfire.Domain;

public sealed record BackendAccount(string UserId, string AccessToken, JsonElement Native);
public sealed record BackendConfiguration(string Type, JsonElement Parameters);
public sealed record BackendDescription(string Type, string Label, string ChatUrl, string SignupUrl, IReadOnlyList<string> SignupInstructions, BackendConfiguration Configuration);
public sealed record AccessField(string Key, string Label, long Minimum, long Maximum, long DefaultValue);
public sealed record BackendPermission(string Action, string Label, bool Allowed);
public sealed record RoomFacts(string RoomId, string Name, string Topic, string? Alias, string BackendUserId,
    bool CanInvite, IReadOnlyList<string> AccessModes, string AuthorityRevision, IReadOnlyList<AccessField> AccessFields, IReadOnlyList<BackendPermission> Permissions);
public sealed record RoomMembership(string BackendUserId, string DisplayName, string Membership, JsonElement? NativeAccess);
public sealed record RoomAccessIntent(string AccessMode, JsonElement? NativeAccess, bool Muted);
public sealed record RoomAdmission(string Kind, string? EventId = null, string? SenderBackendUserId = null);
public sealed record BackendEvent(string EventId, string RoomId, string SenderBackendUserId, string Type, string? MessageType,
    string? Body, IReadOnlyList<string> Mentions, bool Edited, bool Control);
