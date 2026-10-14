using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record InstructionInput(string Text, string MessageId, string Path, NativeFileBoundary? Boundary) : NativeMessage(Text, MessageId);

public static class NativeInstructions
{
    public static readonly NativeCodec<InstructionInput> Codec = new(Decode, Encode);
    private static Result<InstructionInput> Decode(JsonElement value)
    {
        if (!Validation.Fields(value, ["text", "messageId", "path", "boundary"]).IsSuccess || value.GetProperty("text").ValueKind != JsonValueKind.String)
            return Results.Fail<InstructionInput>("invalid", "Invalid native instruction journal");
        var id = Validation.Text(value.GetProperty("messageId"), 100); var path = Validation.Text(value.GetProperty("path"), 4096);
        if (!id.IsSuccess || !id.Value.StartsWith("crossfire-instructions-", StringComparison.Ordinal) || !Guid.TryParseExact(id.Value["crossfire-instructions-".Length..], "D", out _) || !path.IsSuccess)
            return Results.Fail<InstructionInput>("invalid", "Invalid native instruction identity or path");
        NativeFileBoundary? boundary = null; var captured = value.GetProperty("boundary");
        if (captured.ValueKind != JsonValueKind.Null)
        {
            if (!Validation.Fields(captured, ["key", "position", "prefix"]).IsSuccess) return Results.Fail<InstructionInput>("invalid", "Invalid native instruction evidence boundary");
            var key = Validation.Text(captured.GetProperty("key"), 100); var position = Validation.Integer(captured.GetProperty("position")); var prefix = Validation.Text(captured.GetProperty("prefix"), 64, 64);
            if (!key.IsSuccess || !position.IsSuccess || !prefix.IsSuccess || prefix.Value.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9')))
                return Results.Fail<InstructionInput>("invalid", "Invalid native instruction evidence boundary");
            boundary = new(key.Value, position.Value, prefix.Value);
        }
        var text = ProtocolJson.Unquote(value.GetProperty("text").GetRawText()); if (!text.IsSuccess) return Result<InstructionInput>.Fail(text.Error);
        var input = new InstructionInput(text.Value, id.Value, path.Value, boundary);
        return NativeJournal<InstructionInput>.ValidateMessage(input).Map(_ => input);
    }
    private static JsonElement Encode(InstructionInput input) => CodexJson.Object(writer =>
    {
        writer.WriteString("text", input.Text); writer.WriteString("messageId", input.MessageId); writer.WriteString("path", input.Path);
        if (input.Boundary is null) writer.WriteNull("boundary");
        else { writer.WriteStartObject("boundary"); writer.WriteString("key", input.Boundary.Key); writer.WriteNumber("position", input.Boundary.Position); writer.WriteString("prefix", input.Boundary.Prefix); writer.WriteEndObject(); }
    });
    public static async ValueTask<Result<Unit>> Apply(CodexSession session, string home, string journal, string text, CancellationToken cancellation)
    {
        try
        {
            async ValueTask<Result<(string Path, bool Idle)>> Current(CancellationToken scope)
            {
                var response = CodexJson.ObjectReply(await session.Protocol.Request("thread/read", CodexJson.Object(writer => { writer.WriteString("threadId", session.SessionId); writer.WriteBoolean("includeTurns", false); }), scope));
                if (!response.IsSuccess) return Result<(string, bool)>.Fail(response.Error);
                var thread = response.Value.GetProperty("thread"); var state = CodexJson.String(thread.GetProperty("status"), "type"); var path = CodexJson.String(thread, "path");
                if (CodexJson.String(thread, "id") != session.SessionId || thread.GetProperty("canAcceptDirectInput").ValueKind != JsonValueKind.True
                    || state is not ("idle" or "active") || CodexJson.String(thread, "cwd") != session.Workspace || path is null || path.Length > 4096
                    || !Path.IsPathFullyQualified(path) || Path.GetFullPath(path) != path || !path.StartsWith(home + "/sessions/", StringComparison.Ordinal))
                    return Results.Fail<(string, bool)>("native", "Native instructions lost their exact loaded session, workspace or private history");
                return Result<(string, bool)>.Success((path, state == "idle"));
            }
            bool Header(string path)
            {
                var header = NativeHistory.Header(home, path); if (header is null) return false; var record = header.Value;
                if (CodexJson.String(record, "type") != "session_meta" || !record.TryGetProperty("payload", out var payload)
                    || CodexJson.String(payload, "id") != session.SessionId || CodexJson.String(payload, "cwd") != session.Workspace)
                    throw new IOException("Native history does not belong to the selected instruction session");
                return true;
            }
            async ValueTask<Result<Unit>> Verify(CancellationToken scope) => (await Current(scope)).Map(_ => default(Unit));
            async ValueTask<Result<bool>> Inspect() => (await Current(session.Lifetime)).Map(value => !value.Idle);
            async ValueTask<Result<InstructionInput>> Prepare(string content, string id, CancellationToken scope)
            {
                var current = await Current(scope); if (!current.IsSuccess) return Result<InstructionInput>.Fail(current.Error);
                if (!current.Value.Idle) return Results.Fail<InstructionInput>("conflict", "Native instructions require an idle owned session before publication");
                var boundary = NativeHistory.Capture(home, current.Value.Path);
                return boundary is not null && !Header(current.Value.Path) ? Results.Fail<InstructionInput>("native", "Native history header is incomplete before instruction publication")
                    : Result<InstructionInput>.Success(new(content, id, current.Value.Path, boundary));
            }
            async ValueTask<Result<Unit>> Publish(InstructionInput input, Func<InstructionInput, Result<Unit>> retain)
            {
                var current = await Current(session.Lifetime); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
                if (!current.Value.Idle || current.Value.Path != input.Path) return Results.Fail<Unit>("native", "Native instruction publication lost its prepared history");
                return CodexJson.ObjectReply(await session.Protocol.Request("thread/inject_items", CodexJson.Object(writer =>
                {
                    writer.WriteString("threadId", session.SessionId); writer.WriteStartArray("items"); writer.WriteStartObject(); writer.WriteString("type", "message"); writer.WriteString("id", input.MessageId);
                    writer.WriteString("role", "developer"); writer.WriteStartArray("content"); writer.WriteStartObject(); writer.WriteString("type", "input_text"); writer.WriteString("text", input.Text);
                    writer.WriteEndObject(); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndArray();
                }), session.Lifetime)).Map(_ => default(Unit));
            }
            async ValueTask<Result<NativeReceipt>> Received(InstructionInput input, Func<InstructionInput, Result<Unit>> retain, CancellationToken scope, bool restored)
            {
                var current = await Current(scope); if (!current.IsSuccess) return Result<NativeReceipt>.Fail(current.Error);
                if (current.Value.Path != input.Path) return Results.Fail<NativeReceipt>("native", "Native instruction recovery changed its retained history path");
                if (!Header(input.Path)) return Result<NativeReceipt>.Success(NativeReceipt.Pending); var count = 0;
                NativeHistory.Since(home, input.Path, input.Boundary, record =>
                {
                    if (record.ValueKind != JsonValueKind.Object) throw new IOException("Invalid native history record");
                    if (CodexJson.String(record, "type") != "response_item") return;
                    var item = record.GetProperty("payload"); if (item.ValueKind != JsonValueKind.Object) throw new IOException("Invalid native response item");
                    if (CodexJson.String(item, "id") != input.MessageId) return;
                    if (CodexJson.String(item, "type") != "message" || CodexJson.String(item, "role") != "developer" || !item.TryGetProperty("content", out var content)
                        || content.ValueKind != JsonValueKind.Array || content.GetArrayLength() != 1 || CodexJson.String(content[0], "type") != "input_text" || CodexJson.String(content[0], "text") != input.Text)
                        throw new IOException("Native developer instruction differs from its submitted identity or content");
                    if (++count > 1) throw new IOException("Native instruction identity was appended more than once");
                });
                return Result<NativeReceipt>.Success(count == 1 ? NativeReceipt.Received : NativeReceipt.Pending);
            }
            var ports = new PublicationPorts<InstructionInput>(session.SessionId, session.Approval, session.Lifetime, Verify, Inspect, Prepare, Publish, Received, () => ValueTask.CompletedTask);
            var opened = NativeDelivery<InstructionInput>.Open(ports, Codec, journal, 100); if (!opened.IsSuccess) return Result<Unit>.Fail(opened.Error);
            await using var delivery = opened.Value;
            var loaded = NativeJournal<InstructionInput>.Read(journal, session.SessionId, Codec); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var state = loaded.Value;
            if (state.Confirmed.Count > 1 || state.Pending is not null && state.Confirmed.Count != 0) return Results.Fail<Unit>("invalid", "Native instructions have competing revisions");
            if (state.Pending is not null)
            { var recovered = await delivery.Recover(state.Pending.Text, state.Pending.MessageId, cancellation); if (!recovered.IsSuccess) return Result<Unit>.Fail(recovered.Error); }
            loaded = NativeJournal<InstructionInput>.Read(journal, session.SessionId, Codec); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); state = loaded.Value;
            var confirmed = state.Confirmed.SingleOrDefault();
            if (confirmed?.Digest == Identity.Hash(text)) return (await delivery.Recover(text, confirmed.MessageId, cancellation)).Bind(value => value ? Results.Done() : Results.Fail<Unit>("native", "Native instructions lost their confirmed revision"));
            if (confirmed is not null) { var acknowledged = delivery.Acknowledge([confirmed.MessageId]); if (!acknowledged.IsSuccess) return acknowledged; }
            return await delivery.Deliver(text, "crossfire-instructions-" + Identity.Identifier(), cancellation);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException or KeyNotFoundException)
        { return Results.Fail<Unit>("native", "Cannot establish the exact native developer instructions: " + error.Message); }
    }
}
