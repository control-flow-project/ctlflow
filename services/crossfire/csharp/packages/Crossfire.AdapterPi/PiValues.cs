using System.Collections;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed record PiOptions(string? Provider, string? Model, string? Thinking);

public static class PiValues
{
    public static JsonElement Object(Action<ProtocolWriter> write) => WireJson.Object(write);
    public static JsonElement Null { get; } = NullValue();
    private static JsonElement NullValue() { using var document = JsonDocument.Parse("null"); return document.RootElement.Clone(); }
    public static JsonElement Empty() => Object(_ => { });
    public static Result<JsonElement> ObjectReply(Result<JsonElement> value)
        => !value.IsSuccess || value.Value.ValueKind == JsonValueKind.Object ? value : Results.Fail<JsonElement>("invalid", "Native Pi returned a non-object response");
    public static string? Text(JsonElement value, string name) => WireJson.Text(value, name);
    public static Result<PiOptions> Options(JsonElement value)
    {
        var fields = Validation.Fields(value, [], ["provider", "model", "thinking_level"]); if (!fields.IsSuccess) return Result<PiOptions>.Fail(fields.Error);
        string? provider = null, model = null, thinking = null;
        if (value.TryGetProperty("provider", out var selected)) { var parsed = Validation.Text(selected, 200); if (!parsed.IsSuccess) return Result<PiOptions>.Fail(parsed.Error); provider = parsed.Value; }
        if (value.TryGetProperty("model", out selected)) { var parsed = Validation.Text(selected, 200); if (!parsed.IsSuccess) return Result<PiOptions>.Fail(parsed.Error); model = parsed.Value; }
        if (value.TryGetProperty("thinking_level", out selected)) { var parsed = Validation.Choice(selected, "off", "minimal", "low", "medium", "high", "xhigh", "max"); if (!parsed.IsSuccess) return Result<PiOptions>.Fail(parsed.Error); thinking = parsed.Value; }
        return (provider is null) == (model is null) ? Result<PiOptions>.Success(new(provider, model, thinking))
            : Results.Fail<PiOptions>("invalid", "Pi provider and model must be configured together with exact native identities");
    }
    public static string ErrorText(string value)
    {
        var result = new StringBuilder(); var bytes = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            var safe = rune.Value is <= 8 or 11 or 12 or >= 14 and <= 31 or 127 ? new Rune(' ') : rune;
            if (bytes + safe.Utf8SequenceLength > 4000) break; bytes += safe.Utf8SequenceLength; result.Append(safe.ToString());
        }
        return result.ToString();
    }
    public static string Extension()
    {
        using var resource = typeof(PiValues).Assembly.GetManifestResourceStream("Crossfire.Native.PiExtension") ?? throw new IOException("The verified owned Pi extension asset is missing");
        if (resource.Length is < 1 or > 1048576) throw new IOException("The owned Pi extension exceeds its finite byte budget");
        using var reader = new StreamReader(resource, new UTF8Encoding(false, true)); return reader.ReadToEnd();
    }
    public static string Host => System.Environment.GetEnvironmentVariable("PI_CODING_AGENT_DIR") ?? Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile), ".pi/agent");
    public static Result<Unit> Refresh(string home, string source)
    {
        try
        {
            PrivateFiles.ExistingDirectory(home, true);
            if (!Path.IsPathFullyQualified(source) || Path.GetFullPath(source) != source || source == home) return Results.Fail<Unit>("invalid", "The host Pi login directory must be a separate exact absolute path");
            if (PrivateFiles.Exists(source)) PrivateFiles.ExistingDirectory(source, false);
            foreach (var name in new[] { "auth.json", "models.json" })
            {
                var file = Path.Combine(source, name); var target = Path.Combine(home, name);
                if (PrivateFiles.Exists(file))
                {
                    var bytes = PrivateFiles.Read(file, 1048576); using var document = JsonDocument.Parse(bytes);
                    if (document.RootElement.ValueKind != JsonValueKind.Object) return Results.Fail<Unit>("unauthorized", "Invalid private Pi " + name + "; configure it on the host, never in chat");
                    PrivateFiles.Write(target, bytes, 1048576);
                }
                else PrivateFiles.DeletePrivate(target);
            }
            return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("unauthorized", "Cannot refresh private native Pi configuration and authentication; configure them on the host, never in chat"); }
    }
    public static IReadOnlyDictionary<string, string?> Environment(string home, string state, string profile)
    {
        var values = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (DictionaryEntry entry in System.Environment.GetEnvironmentVariables()) if (entry.Key is string key && entry.Value is string value) values[key] = value;
        values["PI_CODING_AGENT_DIR"] = home; values["CROSSFIRE_PROJECT"] = state; values["CROSSFIRE_AGENT_NAME"] = profile; values["CODEX_THREAD_ID"] = null; return values;
    }
}
