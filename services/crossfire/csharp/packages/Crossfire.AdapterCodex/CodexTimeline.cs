using System.Buffers;
using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record NativeTurn(string Id, string Status);
public sealed record TimelineEntry(JsonElement Native, HistoryBoundary Boundary);
public sealed record TimelinePage(IReadOnlyList<TimelineEntry> Entries, string? NextCursor);
public sealed record TimelineBoundary(HistoryBoundary? Boundary, bool Initializing);
public sealed record ReceiptEvidence(string Status, HistoryBoundary? Boundary);

public static class CodexTimeline
{
    public const string UnavailableMethod = "native_timeline_unavailable";
    public const string Unmaterialized = "native_history_unmaterialized";
    public static async ValueTask<Result<string>> State(CodexSession session, CancellationToken cancellation, string? threadId = null)
    {
        var expected = threadId ?? session.SessionId;
        var response = CodexJson.ObjectReply(await session.Protocol.Request("thread/read", CodexJson.Object(writer => { writer.WriteString("threadId", expected); writer.WriteBoolean("includeTurns", false); }), cancellation));
        if (!response.IsSuccess) return Result<string>.Fail(response.Error);
        if (!response.Value.TryGetProperty("thread", out var thread) || thread.ValueKind != JsonValueKind.Object) return Results.Fail<string>("native", "Invalid native Codex thread state");
        var state = thread.TryGetProperty("status", out var status) ? CodexJson.String(status, "type") : null;
        if (CodexJson.String(thread, "id") != expected || state is not ("idle" or "active" or "notLoaded")
            || !thread.TryGetProperty("canAcceptDirectInput", out var direct) || (state == "notLoaded" ? direct.ValueKind != JsonValueKind.Null : direct.ValueKind != JsonValueKind.True)
            || CodexJson.String(thread, "cwd") != session.Workspace) return Results.Fail<string>("native", "The selected native session is not loaded for this exact workspace and identity");
        return Result<string>.Success(state);
    }
    public static async ValueTask<Result<NativeTurn?>> Latest(CodexSession session, CancellationToken cancellation)
    {
        var raw = await session.Protocol.Request("thread/turns/list", CodexJson.Object(writer =>
        { writer.WriteString("threadId", session.SessionId); writer.WriteNumber("limit", 1); writer.WriteString("sortDirection", "desc"); writer.WriteString("itemsView", "notLoaded"); }), cancellation);
        if (raw.IsSuccess && raw.Value.Error is { Code: -32600 } error && error.Message == "thread " + session.SessionId + " is not materialized yet; thread/turns/list is unavailable before first user message")
            return Results.Fail<NativeTurn?>(Unmaterialized, error.Message);
        var response = CodexJson.ObjectReply(raw); if (!response.IsSuccess) return Result<NativeTurn?>.Fail(response.Error);
        if (!response.Value.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > 1) return Results.Fail<NativeTurn?>("native", "Invalid Codex turn page");
        return data.GetArrayLength() == 0 ? Result<NativeTurn?>.Success(null) : Turn(data[0]).Map<NativeTurn?>(value => value);
    }
    private static Result<NativeTurn> Turn(JsonElement value)
    {
        var id = CodexJson.String(value, "id"); var state = CodexJson.String(value, "status");
        return string.IsNullOrEmpty(id) || state is not ("inProgress" or "completed" or "interrupted" or "failed") ? Results.Fail<NativeTurn>("native", "Invalid Codex turn identity or status") : Result<NativeTurn>.Success(new(id, state));
    }
    public static async ValueTask<Result<string>> TurnStatus(CodexSession session, string turnId, CancellationToken cancellation)
    {
        string? cursor = null; var visited = new HashSet<string>(StringComparer.Ordinal);
        for (var page = 0; page < 100; page++)
        {
            var response = CodexJson.ObjectReply(await session.Protocol.Request("thread/turns/list", CodexJson.Object(writer =>
            { writer.WriteString("threadId", session.SessionId); writer.WriteNumber("limit", 100); writer.WriteString("sortDirection", "desc"); writer.WriteString("itemsView", "notLoaded"); if (cursor is not null) writer.WriteString("cursor", cursor); }), cancellation));
            if (!response.IsSuccess) return Result<string>.Fail(response.Error);
            var result = response.Value;
            if (!result.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > 100) return Results.Fail<string>("native", "Invalid Codex turn page");
            foreach (var value in data.EnumerateArray()) if (CodexJson.String(value, "id") == turnId) return Turn(value).Map(turn => turn.Status);
            if (result.TryGetProperty("nextCursor", out var next) && next.ValueKind == JsonValueKind.Null) break;
            cursor = CodexJson.String(result, "nextCursor"); if (string.IsNullOrEmpty(cursor) || data.GetArrayLength() == 0 || !visited.Add(cursor)) return Results.Fail<string>("native", "Invalid Codex turn cursor");
        }
        return Results.Fail<string>("native", "Cannot prove the captured Codex turn status; refusing replacement input");
    }
    public static async ValueTask<Result<TimelinePage>> Page(CodexSession session, int limit, string? cursor, CancellationToken cancellation)
    {
        var raw = await session.Protocol.Request("thread/timeline/list", CodexJson.Object(writer =>
        { writer.WriteString("threadId", session.SessionId); writer.WriteNumber("limit", limit); if (cursor is not null) writer.WriteString("cursor", cursor); }), cancellation);
        if (raw.IsSuccess && raw.Value.Error is { Code: -32601 } unsupported) return Results.Fail<TimelinePage>(UnavailableMethod, unsupported.Message);
        var response = CodexJson.ObjectReply(raw); if (!response.IsSuccess) return Result<TimelinePage>.Fail(response.Error); var result = response.Value;
        if (!result.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > limit
            || !result.TryGetProperty("nextCursor", out var next) || next.ValueKind != JsonValueKind.Null && (next.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(next.GetString()) || data.GetArrayLength() == 0))
            return Results.Fail<TimelinePage>("native", "Invalid Codex input history page or cursor");
        var entries = new List<TimelineEntry>(data.GetArrayLength());
        foreach (var value in data.EnumerateArray().Reverse())
        {
            if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("position", out var index)) return Results.Fail<TimelinePage>("native", "Invalid Codex history entry");
            var position = Validation.Integer(index); var type = CodexJson.String(value, "type"); var turnId = CodexJson.String(value, "turnId"); string? itemId = null;
            if (!position.IsSuccess || type is not ("item" or "realtime" or "turnStarted" or "turnCompleted") || type != "realtime" && string.IsNullOrEmpty(turnId)) return Results.Fail<TimelinePage>("native", "Invalid Codex history position, entry or turn identity");
            if (type is "item" or "realtime")
            {
                if (!value.TryGetProperty("item", out var item) || string.IsNullOrEmpty(itemId = CodexJson.String(item, "id")) || CodexJson.String(item, "type") is null) return Results.Fail<TimelinePage>("native", "Invalid Codex history item");
            }
            if (type == "turnCompleted" && CodexJson.String(value, "status") is not ("completed" or "interrupted" or "failed")) return Results.Fail<TimelinePage>("native", "Invalid Codex turn completion");
            var key = "[" + position.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) + "," + ProtocolJson.Quote(type) + "," + (turnId is null ? "null" : ProtocolJson.Quote(turnId)) + "," + (itemId is null ? "null" : ProtocolJson.Quote(itemId)) + "]";
            entries.Add(new(value.Clone(), new(position.Value, key)));
        }
        return Result<TimelinePage>.Success(new(entries, next.ValueKind == JsonValueKind.Null ? null : next.GetString()));
    }
    public static async ValueTask<Result<TimelineBoundary>> Boundary(CodexSession session, CancellationToken cancellation)
    {
        var page = await Page(session, 1, null, cancellation);
        if (page.IsSuccess) return Result<TimelineBoundary>.Success(new(page.Value.Entries.FirstOrDefault()?.Boundary, false));
        if (page.Error.Code != UnavailableMethod) return Result<TimelineBoundary>.Fail(page.Error);
        var turn = await Latest(session, cancellation);
        return !turn.IsSuccess && turn.Error.Code == Unmaterialized ? Result<TimelineBoundary>.Success(new(null, true)) : Result<TimelineBoundary>.Fail(page.Error);
    }
    private static Result<bool> Matches(JsonElement item, string text, string messageId)
    {
        var type = CodexJson.String(item, "type"); if (type is null) return Results.Fail<bool>("native", "Invalid Codex item");
        if (type != "userMessage" || CodexJson.String(item, "clientId") != messageId) return Result<bool>.Success(false);
        if (string.IsNullOrEmpty(CodexJson.String(item, "id")) || !item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array || content.GetArrayLength() != 1
            || CodexJson.String(content[0], "type") != "text" || CodexJson.String(content[0], "text") != text) return Results.Fail<bool>("native", "Codex input receipt differs from the submitted message");
        return Result<bool>.Success(true);
    }
    public static async ValueTask<Result<ReceiptEvidence>> Receipt(CodexSession session, CodexPublication input, CancellationToken cancellation)
    {
        string? cursor = null; var visited = new HashSet<string>(StringComparer.Ordinal); var seen = new HashSet<string>(StringComparer.Ordinal);
        string? completion = null; var started = false; var newest = input.Boundary; var position = long.MaxValue;
        for (var pageIndex = 0; pageIndex < 100; pageIndex++)
        {
            var response = await Page(session, 100, cursor, cancellation); if (!response.IsSuccess) return Result<ReceiptEvidence>.Fail(response.Error); var page = response.Value;
            if (pageIndex == 0) newest = page.Entries.FirstOrDefault()?.Boundary;
            foreach (var value in page.Entries)
            {
                if (value.Boundary.Position > position || !seen.Add(value.Boundary.Key)) return Results.Fail<ReceiptEvidence>("native", "Invalid Codex input history order"); position = value.Boundary.Position;
            }
            foreach (var value in page.Entries)
            {
                if (input.Boundary is not null && value.Boundary.Key == input.Boundary.Key) return Result<ReceiptEvidence>.Success(new(completion ?? "pending", newest));
                if (input.Boundary is not null && value.Boundary.Position < input.Boundary.Position) return Results.Fail<ReceiptEvidence>("native", "Codex input history lost its verification boundary");
                var entry = value.Native; var type = CodexJson.String(entry, "type");
                if (type == "item")
                {
                    var matching = Matches(entry.GetProperty("item"), input.Text, input.MessageId); if (!matching.IsSuccess) return Result<ReceiptEvidence>.Fail(matching.Error);
                    if (matching.Value)
                    {
                        if (input.Turn is not null && CodexJson.String(entry, "turnId") != input.Turn) return Results.Fail<ReceiptEvidence>("native", "Codex input receipt belongs to a different turn");
                        return Result<ReceiptEvidence>.Success(new("received", newest));
                    }
                }
                if (input.Turn is null || CodexJson.String(entry, "turnId") != input.Turn) continue;
                if (type == "turnCompleted") completion = CodexJson.String(entry, "status") == "interrupted" ? "interrupted" : "missing";
                else if (type == "turnStarted") started = true;
            }
            if (page.NextCursor is null)
            {
                if (input.Boundary is not null) return Results.Fail<ReceiptEvidence>("native", "Codex input history lost its verification boundary");
                return Result<ReceiptEvidence>.Success(new(!started ? "unavailable" : completion ?? "pending", !started ? null : newest));
            }
            if (!visited.Add(page.NextCursor)) return Results.Fail<ReceiptEvidence>("native", "Invalid Codex input history cursor"); cursor = page.NextCursor;
        }
        return Results.Fail<ReceiptEvidence>("native", "Codex input history exceeds the verification bound; read positions were not advanced");
    }
}
