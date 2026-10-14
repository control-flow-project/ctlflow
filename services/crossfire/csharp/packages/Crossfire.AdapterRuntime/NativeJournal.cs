using System.Buffers;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterRuntime;

public abstract record NativeMessage(string Text, string MessageId);
public sealed record NativeCodec<T>(Func<JsonElement, Result<T>> Decode, Func<T, JsonElement> Encode) where T : NativeMessage;
public sealed record NativeConfirmation(string MessageId, string Digest);
public sealed record NativeJournalState<T>(string SessionId, T? Pending, IReadOnlyList<NativeConfirmation> Confirmed) where T : NativeMessage;

public sealed class NativeJournal<T> : IDisposable where T : NativeMessage
{
    public const int MaximumBytes = 33554432;
    public const int MaximumInputBytes = 4194304;
    private readonly string file;
    private readonly NativeCodec<T> codec;
    private readonly StateLock ownership;
    private readonly object gate = new();
    private NativeJournalState<T> state;
    private bool closed;
    private NativeJournal(string file, NativeCodec<T> codec, StateLock ownership, NativeJournalState<T> state)
    { this.file = file; this.codec = codec; this.ownership = ownership; this.state = state; }

    public static Result<NativeJournal<T>> Open(string path, string session, NativeCodec<T> codec)
    {
        StateLock? ownership = null;
        try
        {
            if (session.Length is < 1 or > 200 || session.Any(char.IsControl)) return Results.Fail<NativeJournal<T>>("invalid", "Invalid native journal session identity");
            var file = Path.GetFullPath(path); PrivateFiles.Directory(Path.GetDirectoryName(file)!); ownership = new(file);
            var read = Read(file, session, codec); if (!read.IsSuccess) { ownership.Dispose(); return Result<NativeJournal<T>>.Fail(read.Error); }
            return Result<NativeJournal<T>>.Success(new(file, codec, ownership, read.Value));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { ownership?.Dispose(); return Results.Fail<NativeJournal<T>>("invalid", "Cannot own the bounded private native delivery journal: " + error.Message); }
    }
    public static Result<NativeJournalState<T>> Read(string file, string session, NativeCodec<T> codec)
    {
        try
        {
            if (!PrivateFiles.Exists(file)) return Result<NativeJournalState<T>>.Success(new(session, null, []));
            using var document = JsonDocument.Parse(PrivateFiles.Read(file, MaximumBytes)); var input = document.RootElement;
            var fields = Validation.Fields(input, ["sessionId", "pending", "confirmed"]);
            if (!fields.IsSuccess || input.GetProperty("sessionId").ValueKind != JsonValueKind.String || input.GetProperty("sessionId").GetString() != session)
                return Results.Fail<NativeJournalState<T>>("invalid", "Invalid native delivery journal or session binding");
            T? pending = null;
            if (input.GetProperty("pending").ValueKind != JsonValueKind.Null)
            { var parsed = codec.Decode(input.GetProperty("pending")); if (!parsed.IsSuccess) return Result<NativeJournalState<T>>.Fail(parsed.Error); pending = parsed.Value; }
            var confirmed = Validation.List(input.GetProperty("confirmed"), ParseConfirmation, 128);
            if (!confirmed.IsSuccess) return Result<NativeJournalState<T>>.Fail(confirmed.Error);
            if (confirmed.Value.Select(value => value.MessageId).Distinct(StringComparer.Ordinal).Count() != confirmed.Value.Count
                || pending is not null && confirmed.Value.Any(value => value.MessageId == pending.MessageId))
                return Results.Fail<NativeJournalState<T>>("invalid", "Native input cannot be duplicated or both pending and confirmed");
            return Result<NativeJournalState<T>>.Success(new(session, pending, confirmed.Value));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<NativeJournalState<T>>("invalid", "Invalid private native delivery journal"); }
    }
    private static Result<NativeConfirmation> ParseConfirmation(JsonElement input)
    {
        var fields = Validation.Fields(input, ["messageId", "digest"]); if (!fields.IsSuccess) return Result<NativeConfirmation>.Fail(fields.Error);
        var id = Validation.Text(input.GetProperty("messageId"), 200); var digest = Validation.Text(input.GetProperty("digest"), 64, 64);
        return id.IsSuccess && digest.IsSuccess && digest.Value.All(value => value is >= '0' and <= '9' or >= 'a' and <= 'f')
            ? Result<NativeConfirmation>.Success(new(id.Value, digest.Value)) : Results.Fail<NativeConfirmation>("invalid", "Invalid native receipt digest or identity");
    }
    public static Result<Unit> ValidateMessage(NativeMessage input)
        => input.MessageId.Length is >= 1 and <= 200 && !input.MessageId.Any(char.IsControl) && Encoding.UTF8.GetByteCount(input.Text) <= MaximumInputBytes
            ? Results.Done() : Results.Fail<Unit>("invalid", "Invalid native delivery identity or text byte bound");

    public T? Pending { get { lock (gate) { Owned(); return state.Pending; } } }
    public bool Unsettled { get { lock (gate) { Owned(); return state.Pending is not null || state.Confirmed.Count > 0; } } }
    private void Owned() { if (closed) throw new InvalidOperationException("Native delivery journal is closed"); }
    public Result<bool> Confirmed(string text, string messageId)
    {
        lock (gate)
        {
            Owned(); var existing = state.Confirmed.FirstOrDefault(value => value.MessageId == messageId);
            return existing is not null && existing.Digest != Identity.Hash(text) ? Results.Fail<bool>("conflict", "Native delivery identity was reused with different content") : Result<bool>.Success(existing is not null);
        }
    }
    public Result<Unit> Prepare(T input)
    {
        lock (gate)
        {
            Owned(); var valid = ValidateMessage(input); if (!valid.IsSuccess) return valid;
            var decoded = codec.Decode(codec.Encode(input)); if (!decoded.IsSuccess) return Result<Unit>.Fail(decoded.Error);
            if (decoded.Value.MessageId != input.MessageId || decoded.Value.Text != input.Text) return Results.Fail<Unit>("invalid", "Native codec changed its message identity or content");
            if (state.Pending is not null && (state.Pending.MessageId != input.MessageId || state.Pending.Text != input.Text)) return Results.Fail<Unit>("conflict", "Native evidence cannot replace its original input identity or content");
            if (state.Confirmed.Count >= 128 || state.Confirmed.Any(value => value.MessageId == input.MessageId)) return Results.Fail<Unit>("conflict", "Acknowledge confirmed native deliveries before submitting more input");
            return Save(state with { Pending = decoded.Value });
        }
    }
    public Result<Unit> Complete(T input, bool received)
    {
        lock (gate)
        {
            Owned(); if (state.Pending is null || state.Pending.MessageId != input.MessageId || state.Pending.Text != input.Text) return Results.Fail<Unit>("conflict", "Native confirmation does not match its original pending message");
            var confirmed = state.Confirmed;
            if (received && !confirmed.Any(value => value.MessageId == input.MessageId)) confirmed = [.. confirmed, new(input.MessageId, Identity.Hash(input.Text))];
            return Save(state with { Pending = null, Confirmed = confirmed });
        }
    }
    public Result<Unit> Acknowledge(IReadOnlyList<string> messageIds)
    {
        lock (gate) { Owned(); var ids = messageIds.ToHashSet(StringComparer.Ordinal); return Save(state with { Confirmed = state.Confirmed.Where(value => !ids.Contains(value.MessageId)).ToArray() }); }
    }
    private Result<Unit> Save(NativeJournalState<T> value)
    {
        try
        {
            var bytes = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(bytes))
            {
                writer.WriteStartObject(); writer.WriteString("sessionId", value.SessionId); writer.WritePropertyName("pending");
                if (value.Pending is null) writer.WriteNullValue(); else codec.Encode(value.Pending).WriteTo(writer);
                writer.WriteStartArray("confirmed");
                foreach (var receipt in value.Confirmed) { writer.WriteStartObject(); writer.WriteString("messageId", receipt.MessageId); writer.WriteString("digest", receipt.Digest); writer.WriteEndObject(); }
                writer.WriteEndArray(); writer.WriteEndObject();
            }
            PrivateFiles.Write(file, bytes.WrittenSpan, MaximumBytes); state = value; return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("unavailable", "Native delivery evidence could not be durably saved; no read position may advance"); }
    }
    public void Dispose() { lock (gate) { if (closed) return; closed = true; ownership.Dispose(); } }
}
