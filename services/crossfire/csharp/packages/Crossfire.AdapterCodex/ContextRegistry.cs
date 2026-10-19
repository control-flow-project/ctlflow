using Crossfire.Domain;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record ContextBinding(string Context, string SessionId);
public sealed record ContextRegistryState(string Mode, IReadOnlyList<ContextBinding> Bindings);

public static class ContextRegistry
{
    public const string FileName = "crossfire-context-registry.json";
    public static string Mode(NativeHistoryMode mode) => mode switch { NativeHistoryMode.Shared => "shared", NativeHistoryMode.PerRoom => "per-room", _ => throw new ArgumentException("Unknown native history mode") };
    public static string Receipt(string home, string context) => Path.Combine(home, FileName + "." + Identity.Hash(context) + ".receipt");
    public static bool ValidContext(string value) => HistoryContext.Valid(value);
    private static Result<ContextBinding> Binding(JsonElement input)
    {
        if (!Validation.Fields(input, ["context", "sessionId"]).IsSuccess) return Results.Fail<ContextBinding>("invalid", "Invalid native history binding");
        var context = Validation.Text(input.GetProperty("context"), HistoryContext.MaximumLength); var session = Validation.Text(input.GetProperty("sessionId"), 100);
        return context.IsSuccess && ValidContext(context.Value) && session.IsSuccess && Validation.Identifier(session.Value)
            ? Result<ContextBinding>.Success(new(context.Value, session.Value)) : Results.Fail<ContextBinding>("invalid", "Invalid native history context or session identity");
    }
    public static Result<ContextRegistryState> Decode(JsonElement input)
    {
        if (!Validation.Fields(input, ["mode", "bindings"]).IsSuccess) return Results.Fail<ContextRegistryState>("invalid", "Invalid native history registry");
        var mode = Validation.Choice(input.GetProperty("mode"), "shared", "per-room"); var bindings = Validation.List(input.GetProperty("bindings"), Binding, 2002);
        if (!mode.IsSuccess || !bindings.IsSuccess) return Results.Fail<ContextRegistryState>("invalid", "Invalid native history registry");
        if (bindings.Value.Select(value => value.Context).Distinct(StringComparer.Ordinal).Count() != bindings.Value.Count
            || bindings.Value.Select(value => value.SessionId).Distinct(StringComparer.Ordinal).Count() != bindings.Value.Count)
            return Results.Fail<ContextRegistryState>("invalid", "Native history bindings require unique rooms and distinct session identities");
        return Result<ContextRegistryState>.Success(new(mode.Value, bindings.Value));
    }
    public static Result<ContextRegistryState> Read(string home)
    {
        try
        {
            PrivateFiles.ExistingDirectory(home, true);
            var file = Path.Combine(home, FileName);
            if (!PrivateFiles.Exists(file)) return Result<ContextRegistryState>.Success(new("shared", []));
            using var document = JsonDocument.Parse(PrivateFiles.Read(file, 33554432)); return Decode(document.RootElement);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<ContextRegistryState>("invalid", "Cannot read the exact private native context registry"); }
    }
    public static Result<Unit> Write(string home, ContextRegistryState state)
    {
        try
        {
            var value = Encode(state);
            var valid = Decode(value); if (!valid.IsSuccess) return Result<Unit>.Fail(valid.Error);
            PrivateFiles.Write(Path.Combine(home, FileName), Encoding.UTF8.GetBytes(value.GetRawText()), 33554432); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("unavailable", "Cannot durably retain the exact native history bindings"); }
    }
    public static JsonElement Encode(ContextRegistryState state) => WireJson.Object(writer => { writer.WriteString("mode", state.Mode); writer.WriteStartArray("bindings"); foreach (var binding in state.Bindings) { writer.WriteStartObject(); writer.WriteString("context", binding.Context); writer.WriteString("sessionId", binding.SessionId); writer.WriteEndObject(); } writer.WriteEndArray(); });
    public static Result<IReadOnlyList<SavedRuntimeContext>> Saved(string workspace, string state)
    {
        try
        {
            ManagedHome.Directories(workspace, state); var home = Path.Combine(state, ".codex");
            return PrivateFiles.Exists(home) ? Read(home).Map<IReadOnlyList<SavedRuntimeContext>>(value => value.Bindings.Select(binding => new SavedRuntimeContext(binding.Context, "codex", binding.SessionId, workspace)).ToArray())
                : Result<IReadOnlyList<SavedRuntimeContext>>.Success([]);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { return Results.Fail<IReadOnlyList<SavedRuntimeContext>>("invalid", "Cannot inspect saved private native history bindings"); }
    }
}
