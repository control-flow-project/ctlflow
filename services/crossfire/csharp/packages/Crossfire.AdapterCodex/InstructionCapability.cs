using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class InstructionCapability
{
    public static Result<Unit> Validate(JsonElement schema)
    {
        if (schema.ValueKind != JsonValueKind.Object || !schema.TryGetProperty("definitions", out var definitions) || definitions.ValueKind != JsonValueKind.Object
            || !definitions.TryGetProperty("ThreadInjectItemsParams", out var parameters) || parameters.ValueKind != JsonValueKind.Object
            || CodexJson.String(parameters, "type") != "object" || !parameters.TryGetProperty("properties", out var properties) || properties.ValueKind != JsonValueKind.Object
            || !properties.TryGetProperty("items", out var items) || CodexJson.String(items, "type") != "array"
            || !properties.TryGetProperty("threadId", out var thread) || CodexJson.String(thread, "type") != "string"
            || !parameters.TryGetProperty("required", out var required) || required.ValueKind != JsonValueKind.Array
            || !new[] { "items", "threadId" }.All(key => required.EnumerateArray().Any(value => value.ValueKind == JsonValueKind.String && value.GetString() == key))
            || !schema.TryGetProperty("oneOf", out var methods) || methods.ValueKind != JsonValueKind.Array || !methods.EnumerateArray().Any(InjectMethod))
            return Results.Fail<Unit>("native", "Install a native Codex release supporting experimental thread/inject_items developer instructions, then repeat fleet setup");
        return Results.Done();
    }
    private static bool InjectMethod(JsonElement value)
        => value.ValueKind == JsonValueKind.Object && value.TryGetProperty("properties", out var fields) && fields.ValueKind == JsonValueKind.Object
            && fields.TryGetProperty("method", out var method) && method.ValueKind == JsonValueKind.Object && method.TryGetProperty("enum", out var names)
            && names.ValueKind == JsonValueKind.Array && names.GetArrayLength() == 1 && names[0].ValueKind == JsonValueKind.String && names[0].GetString() == "thread/inject_items"
            && fields.TryGetProperty("params", out var input) && CodexJson.String(input, "$ref") == "#/definitions/ThreadInjectItemsParams";

    public static async ValueTask<Result<Unit>> Inspect(string binary, string home, string workspace, IReadOnlyDictionary<string, string?> environment, CancellationToken cancellation)
    {
        var directory = PrivateFiles.Directory(Path.Combine(home, ".crossfire-protocol-" + Identity.Identifier()));
        try
        {
            var command = await NativeProcess.Capture(new(binary, ["app-server", "generate-json-schema", "--out", directory, "--experimental"], workspace, environment), 65536, 10000, cancellation);
            if (!command.IsSuccess) return Result<Unit>.Fail(command.Error);
            if (command.Value.ExitCode != 0) return Results.Fail<Unit>("native", "Cannot inspect native Codex developer-instruction capability; install a supported release and repeat setup");
            using var document = JsonDocument.Parse(PrivateFiles.ReadNativeEvidence(directory, "ClientRequest.json", 2097152));
            return Validate(document.RootElement);
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        { return Results.Fail<Unit>("native", "Cannot read the native Codex developer-instruction capability"); }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
