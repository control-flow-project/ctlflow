using System.Text.Json;
using Crossfire.Kernel;
using Crossfire.Domain;

namespace Crossfire.AgentCore;

public sealed record AgentProfile(ClientSettings Settings, string Workspace, string Id, BackendAccount Account);
public sealed record LocalState(Func<string, bool> Exists, Func<string, int, byte[]> Read, Action<string, ReadOnlyMemory<byte>, int> Write, Action<string> Remove);
public sealed record AgentOrigin(string Kind, string? Name, string? Alias);
public sealed record ContentFile(string File, long Bytes, string Sha256, long SourceBytes, long AttachmentBytes);
public sealed record ReceivedEvent(string RoomId, AgentOrigin Origin, string EventId, string Sender, string Type, MessageContent Content,
    string? Timestamp, string? SubjectId = null, IReadOnlyList<string>? Omitted = null, ContentFile? ContentFile = null);
public sealed record ReadBatch(IReadOnlyList<ReceivedEvent> Events, IReadOnlyDictionary<string, string> Cursors, IReadOnlyList<string> MoreRooms, IReadOnlyDictionary<string, string> Latest);
public sealed record HistoryEnd(string Cursor, MessageEvent? Event);
public sealed record HistoryWindow(IReadOnlyDictionary<string, string> Cursors, IReadOnlyDictionary<string, HistoryEnd> Ends);
public static class AgentIO
{
    public const int HistoryBytes = 67108864;
    public const int DefaultInputBytes = 65536;
    public const int MaximumInputBytes = 4194304;
    public static string Segment(string value) => Uri.EscapeDataString(value);
    public static JsonElement Read(LocalState state, string file, int bytes = 1048576) => WireJson.Parse(state.Read(file, bytes));
    public static void Write(LocalState state, string file, JsonElement value, int bytes = 1048576) => state.Write(file, WireJson.Bytes(value, true), bytes);
    public static void Remove(LocalState state, string file) { if (state.Exists(file)) state.Remove(file); }
    public static async ValueTask<Result<T>> Boundary<T>(Func<ValueTask<Result<T>>> action)
    {
        try { return await action(); }
        catch (OperationCanceledException) { return Results.Fail<T>("unavailable", "The receiver operation was cancelled before completion"); }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or OverflowException or KeyNotFoundException)
        { return Results.Fail<T>("invalid", "The exact receiver state or native response is invalid: " + error.Message); }
    }
}
