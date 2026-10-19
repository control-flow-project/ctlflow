using Crossfire.Domain;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed record PiBinding(string Context, string File, string? SessionId, string? InstructionsDigest);
public sealed record PiRegistry(string Mode, IReadOnlyList<PiBinding> Bindings);

public static class PiState
{
    public const string FileName = "crossfire-contexts.json";
    public static PiBinding Allocate(string context) => new(context, Identity.Hash(context) + ".jsonl", null, null);
    public static string History(string home, PiBinding binding)
    {
        if (binding.File != Allocate(binding.Context).File) throw new IOException("Invalid canonical Pi history allocation");
        return Path.Combine(home, "histories", binding.File);
    }
    private static Result<PiBinding> DecodeBinding(JsonElement value)
    {
        if (!Validation.Fields(value, ["context", "file", "sessionId", "instructionsDigest"]).IsSuccess) return Results.Fail<PiBinding>("invalid", "Invalid Pi history allocation");
        var context = Validation.Text(value.GetProperty("context"), HistoryContext.MaximumLength); var file = Validation.Text(value.GetProperty("file"), 80);
        var session = Validation.NullableText(value.GetProperty("sessionId"), 100); var digest = Validation.NullableText(value.GetProperty("instructionsDigest"), 64);
        return context.IsSuccess && HistoryContext.Valid(context.Value) && file.IsSuccess && file.Value == Allocate(context.Value).File && session.IsSuccess && (session.Value is null || Validation.Identifier(session.Value))
            && digest.IsSuccess && (digest.Value is null || digest.Value.Length == 64 && digest.Value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f'))
            ? Result<PiBinding>.Success(new(context.Value, file.Value, session.Value, digest.Value)) : Results.Fail<PiBinding>("invalid", "Invalid canonical Pi context allocation");
    }
    public static Result<PiRegistry> Decode(JsonElement input)
    {
        if (!Validation.Fields(input, ["mode", "bindings"]).IsSuccess) return Results.Fail<PiRegistry>("invalid", "Invalid Pi context registry");
        var mode = Validation.Choice(input.GetProperty("mode"), "shared", "per-room"); var bindings = Validation.List(input.GetProperty("bindings"), DecodeBinding, 2002);
        if (!mode.IsSuccess || !bindings.IsSuccess) return Results.Fail<PiRegistry>("invalid", "Invalid Pi context registry");
        var sessions = bindings.Value.Where(value => value.SessionId is not null).Select(value => value.SessionId).ToArray();
        return bindings.Value.Select(value => value.Context).Distinct(StringComparer.Ordinal).Count() == bindings.Value.Count
            && bindings.Value.Select(value => value.File).Distinct(StringComparer.Ordinal).Count() == bindings.Value.Count && sessions.Distinct(StringComparer.Ordinal).Count() == sessions.Length
            ? Result<PiRegistry>.Success(new(mode.Value, bindings.Value)) : Results.Fail<PiRegistry>("invalid", "Pi histories require unique contexts, allocations and native identities");
    }
    public static Result<PiRegistry> Read(string home)
    {
        try
        {
            PrivateFiles.ExistingDirectory(home, true); var file = Path.Combine(home, FileName);
            if (!PrivateFiles.Exists(file)) return Result<PiRegistry>.Success(new("shared", []));
            using var document = JsonDocument.Parse(PrivateFiles.Read(file, 33554432)); return Decode(document.RootElement);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<PiRegistry>("invalid", "Cannot read the exact private Pi context registry"); }
    }
    public static Result<Unit> Write(string home, PiRegistry state)
    {
        try
        {
            var value = PiValues.Object(writer =>
            {
                writer.WriteString("mode", state.Mode); writer.WriteStartArray("bindings");
                foreach (var binding in state.Bindings)
                {
                    writer.WriteStartObject(); writer.WriteString("context", binding.Context); writer.WriteString("file", binding.File);
                    writer.WriteString("sessionId", binding.SessionId); writer.WriteString("instructionsDigest", binding.InstructionsDigest); writer.WriteEndObject();
                }
                writer.WriteEndArray();
            });
            var parsed = Decode(value); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error);
            PrivateFiles.Write(Path.Combine(home, FileName), Encoding.UTF8.GetBytes(value.GetRawText()), 33554432); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("unavailable", "Cannot durably save exact Pi history allocations"); }
    }
    public static Result<Unit> Verify(string home, string history, string workspace, string sessionId)
    {
        var header = NativeHistory.Header(home, history);
        if (header is null) return Results.Fail<Unit>("missing", "Saved Pi history is missing; resume cannot create a different history");
        return PiValues.Text(header.Value, "type") == "session" && PiValues.Text(header.Value, "id") == sessionId && PiValues.Text(header.Value, "cwd") == workspace
            && header.Value.TryGetProperty("version", out var version) && version.TryGetInt32(out var number) && number == 3
            ? Results.Done() : Results.Fail<Unit>("conflict", "Pi history identity, workspace or native format changed");
    }
    public static Result<PiBinding> ReadBinding(string home, PiBinding binding, string workspace, bool allocate)
    {
        try
        {
            var history = History(home, binding);
            if (binding.SessionId is not null) return Verify(home, history, workspace, binding.SessionId).Map(_ => binding);
            if (!PrivateFiles.Exists(history))
            {
                if (!allocate) return Result<PiBinding>.Success(binding);
                PrivateFiles.Directory(Path.GetDirectoryName(history)!); PrivateFiles.Write(history, [], 1);
            }
            if (NativeHistory.Length(home, history) == 0) return Result<PiBinding>.Success(binding);
            var header = NativeHistory.Header(home, history); var id = header is null ? null : PiValues.Text(header.Value, "id");
            if (id is null || !Validation.Identifier(id)) return Results.Fail<PiBinding>("invalid", "Allocated Pi history is not a valid native session");
            return Verify(home, history, workspace, id).Map(_ => binding with { SessionId = id });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<PiBinding>("invalid", "Cannot inspect or allocate the exact native Pi history"); }
    }
    public static Result<Unit> Instructions(string home, string history, NativeFileBoundary? since, string entryId, string digest, string text)
    {
        var found = false;
        NativeHistory.Since(home, history, since, value =>
        {
            if (PiValues.Text(value, "type") == "custom" && PiValues.Text(value, "id") == entryId && PiValues.Text(value, "customType") == "crossfire-instructions")
                found = value.TryGetProperty("data", out var data) && PiValues.Text(data, "digest") == digest && PiValues.Text(data, "text") == text;
        });
        if (!found) return Results.Fail<Unit>("conflict", "Pi did not persist the exact instruction receipt");
        NativeHistory.MakePrivateAndFlush(home, history); return Results.Done();
    }
}
