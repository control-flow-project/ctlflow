using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record ClientSettings(string Instance, string Server, BackendConfiguration Backend, string Owner, int MaxUploadBytes);
public sealed record MessageAttachment(string Id, string? Name, string? MediaType, long? Bytes);
public sealed record MessageContent(string Kind, string? Body, IReadOnlyList<string> Mentions, bool Edited, bool Control,
    IReadOnlyList<MessageAttachment> Attachments, JsonElement Attributes);
public sealed record MessageEvent(string EventId, string RoomId, string Sender, string Type, MessageContent Content, string? SubjectId, long? SentAt, IReadOnlyList<string>? Omitted = null);
public sealed record EventFilter(IReadOnlyList<string>? Types = null, IReadOnlyList<string>? Senders = null);
public sealed record MessagePageRequest(string Direction, int Limit, string? From = null, string? To = null, EventFilter? Filter = null);
public sealed record MessagePage(IReadOnlyList<MessageEvent> Events, string? Start, string? End, int RequestedLimit);
public sealed record RoomOrigin(string Kind, string? Name, string? Alias);
public sealed record RoomFeed(IReadOnlyList<MessageEvent> Events, bool Limited, string? PreviousCursor, JsonElement? Notifications, IReadOnlyList<JsonElement> ReadState);
public sealed record MessageFeed(string Cursor, IReadOnlyDictionary<string, RoomFeed> Rooms, IReadOnlyList<string> Invitations,
    IReadOnlyList<string> DepartedRooms, IReadOnlyList<string> ResetRooms);
public sealed record MessagingClient(
    Func<CancellationToken, ValueTask<Result<string>>> Identify,
    Func<CancellationToken, ValueTask<Result<IReadOnlySet<string>>>> JoinedRooms,
    Func<string, CancellationToken, ValueTask<Result<IReadOnlySet<string>>>> JoinedMembers,
    Func<string?, int, CancellationToken, ValueTask<Result<MessageFeed>>> Synchronize,
    Func<string, MessagePageRequest, CancellationToken, ValueTask<Result<MessagePage>>> History,
    Func<string, string, CancellationToken, ValueTask<Result<MessageEvent>>> Event,
    Func<string, CancellationToken, ValueTask<Result<IReadOnlyList<JsonElement>>>> RoomState,
    Func<string, IReadOnlyList<string>, CancellationToken, ValueTask<Result<IReadOnlyDictionary<string, RoomOrigin>>>> Origins,
    Func<string, string, CancellationToken, ValueTask<Result<Unit>>> Acknowledge,
    Func<string, string, string, CancellationToken, ValueTask<Result<Unit>>> SendNotice,
    Func<string, string, bool, int, CancellationToken, ValueTask<Result<Unit>>> Thinking,
    Func<string, string, string, CancellationToken, ValueTask<Result<Unit>>> VerifyPrivateConversation,
    Func<string, bool> NoticeFits, Func<string, IReadOnlyList<string>> NoticeChunks);
public sealed record MessagingConnection(MessagingClient Client, Func<CancellationToken, ValueTask<Result<IReadOnlyList<string>>>> InvitationRooms);
public delegate Result<MessagingConnection> MessagingConnector(BackendConfiguration configuration, BackendAccount account);
