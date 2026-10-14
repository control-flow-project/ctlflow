using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed record AgentSettings(string Instance, string Homeserver, string ServerName, string Owner, int MaxUploadBytes);
public sealed record AgentAccount(string UserId, string AccessToken, string DeviceId);
public sealed record AgentProfile(AgentSettings Settings, string Workspace, string Id, AgentAccount Account);
public sealed record LocalState(Func<string, bool> Exists, Func<string, int, byte[]> Read, Action<string, ReadOnlyMemory<byte>, int> Write, Action<string> Remove);
public sealed record MatrixRequest(string Method, string Path, JsonElement? Body = null, IReadOnlyDictionary<string, string>? Query = null, int MaximumBytes = 1048576);
public sealed record MatrixResponse(int Status, JsonElement Body);
public sealed record AgentMatrix(Func<MatrixRequest, CancellationToken, ValueTask<Result<MatrixResponse>>> Request);
public sealed record AgentOrigin(string Kind, string? Name, string? Alias);
public sealed record ContentFile(string File, long Bytes, string Sha256, long SourceBytes, long AttachmentBytes);
public sealed record ReceivedEvent(string RoomId, AgentOrigin Origin, string EventId, string Sender, string Type, JsonElement Content,
    string? Timestamp, string? StateKey = null, IReadOnlyList<string>? Omitted = null, ContentFile? ContentFile = null);
public sealed record ReadBatch(IReadOnlyList<ReceivedEvent> Events, IReadOnlyDictionary<string, string> Cursors, IReadOnlyList<string> MoreRooms, IReadOnlyDictionary<string, string> Latest);
public sealed record HistoryEnd(string Cursor, JsonElement? Event);
public sealed record HistoryWindow(IReadOnlyDictionary<string, string> Cursors, IReadOnlyDictionary<string, HistoryEnd> Ends);
public sealed record NativePage(IReadOnlyList<JsonElement> Chunk, string? Start, string? End, int RequestedLimit);
public static class AgentIO
{
    public const int HistoryBytes = 67108864;
    public const int DefaultInputBytes = 65536;
    public const int MaximumInputBytes = 4194304;
    public const string MatrixApi = "/_matrix/client/v3";
    public static string Segment(string value) => Uri.EscapeDataString(value);
    public static JsonElement Read(LocalState state, string file, int bytes = 1048576) => WireJson.Parse(state.Read(file, bytes));
    public static void Write(LocalState state, string file, JsonElement value, int bytes = 1048576) => state.Write(file, WireJson.Bytes(value, true), bytes);
    public static void Remove(LocalState state, string file) { if (state.Exists(file)) state.Remove(file); }
    public static async ValueTask<Result<JsonElement>> Request(AgentMatrix matrix, MatrixRequest request, CancellationToken cancellation)
    {
        var response = await matrix.Request(request, cancellation); if (!response.IsSuccess) return Result<JsonElement>.Fail(response.Error);
        return response.Value.Status is >= 200 and <= 299 ? Result<JsonElement>.Success(response.Value.Body)
            : Results.Fail<JsonElement>(response.Value.Status is 401 or 403 ? "forbidden" : response.Value.Status == 404 ? "missing" : "native", "Matrix request failed with status " + response.Value.Status);
    }
    public static async ValueTask<Result<T>> Boundary<T>(Func<ValueTask<Result<T>>> action)
    {
        try { return await action(); }
        catch (OperationCanceledException) { return Results.Fail<T>("unavailable", "The receiver operation was cancelled before completion"); }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or OverflowException or KeyNotFoundException)
        { return Results.Fail<T>("invalid", "The exact receiver state or native response is invalid: " + error.Message); }
    }
}
