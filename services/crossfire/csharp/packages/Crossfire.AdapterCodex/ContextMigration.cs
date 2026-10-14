using System.Security.Cryptography;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record ContextMigrationOutcome(bool Migrated, int Contexts);
public static class ContextMigration
{
    private const int Maximum = 33554432;
    private static T Value<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new InvalidDataException(value.Error.Message);
    private static string Digest(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static string[] Obsolete(string home) => Directory.EnumerateFileSystemEntries(home).Select(Path.GetFileName).Where(name => name is not null && ContextRegistry.ObsoleteFile(name)).Select(name => name!).Order(StringComparer.Ordinal).ToArray();
    private static JsonElement? Prepare(string home)
    {
        var files = Obsolete(home); if (files.Length == 0) return null; if (PrivateFiles.Exists(Path.Combine(home, ContextRegistry.FileName))) throw new InvalidDataException("Canonical and obsolete native contexts coexist without an explicit migration manifest"); var bindings = new List<ContextBinding>(); var mode = "shared";
        var previousFile = Path.Combine(home, "crossfire-contexts.json"); if (PrivateFiles.Exists(previousFile))
        {
            var previous = WireJson.Parse(PrivateFiles.Read(previousFile, Maximum)); Value(Validation.Fields(previous, ["mode", "control", "rooms"])); mode = Value(Validation.Choice(previous.GetProperty("mode"), "shared", "per-room")); var control = Value(Validation.NullableText(previous.GetProperty("control"))); if (control is not null) bindings.Add(new("control", control));
            var rooms = previous.GetProperty("rooms"); if (rooms.ValueKind != JsonValueKind.Array || rooms.GetArrayLength() > 2000) throw new InvalidDataException("Invalid previous room contexts"); foreach (var room in rooms.EnumerateArray()) { Value(Validation.Fields(room, ["room", "sessionId"])); bindings.Add(new(WireJson.Text(room, "room") ?? "", WireJson.Text(room, "sessionId") ?? "")); }
        }
        var sharedFile = Path.Combine(home, "crossfire-session.json"); if (PrivateFiles.Exists(sharedFile)) { var shared = WireJson.Parse(PrivateFiles.Read(sharedFile, Maximum)); Value(Validation.Fields(shared, ["sessionId"])); bindings.Insert(0, new("shared", WireJson.Text(shared, "sessionId") ?? "")); }
        var registry = Value(ContextRegistry.Decode(ContextRegistry.Encode(new(mode, bindings)))); var expected = ContextRegistry.MigrationFiles(registry); var originals = new List<(string Name, string Digest, string? Target)>();
        foreach (var name in files)
        {
            if (!expected.TryGetValue(name, out var selected)) throw new InvalidDataException("Unrecognized obsolete native metadata; migration never guesses or discards it"); var path = Path.Combine(home, name); var bytes = PrivateFiles.Read(path, Maximum);
            if (selected.Session is { } session) { if (selected.Instructions) Value(NativeJournal<InstructionInput>.Read(path, session, NativeInstructions.Codec)); else Value(NativeJournal<CodexInput>.Read(path, session, CodexInputCodec.Codec)); } originals.Add((name, Digest(bytes), selected.Target));
        }
        return WireJson.Object(writer => { writer.WriteString("phase", "prepared"); writer.WritePropertyName("registry"); ContextRegistry.Encode(registry).WriteTo(writer); writer.WriteStartArray("files"); foreach (var file in originals) { writer.WriteStartObject(); writer.WriteString("name", file.Name); writer.WriteString("digest", file.Digest); writer.WriteString("target", file.Target); writer.WriteEndObject(); } writer.WriteEndArray(); });
    }
    public static Result<ContextMigrationOutcome> Run(string workspace, string state)
    {
        var locks = new List<StateLock>(); try
        {
            ManagedHome.Directories(workspace, state); var home = Path.Combine(state, ".codex"); if (!PrivateFiles.Exists(home)) return Result<ContextMigrationOutcome>.Success(new(false, 0)); PrivateFiles.ExistingDirectory(home, true);
            foreach (var name in Obsolete(home).Where(name => name.EndsWith(".lock", StringComparison.Ordinal))) locks.Add(new StateLock(Path.Combine(home, name[..^5])));
            var manifest = Path.Combine(home, ContextRegistry.Migration); var plan = PrivateFiles.Exists(manifest) ? WireJson.Parse(PrivateFiles.Read(manifest, Maximum)) : Prepare(home);
            if (plan is null) return ContextRegistry.Read(home).Map(value => new ContextMigrationOutcome(false, value.Bindings.Count)); if (!ContextRegistry.ValidMigration(plan.Value, false)) throw new InvalidDataException("Invalid exact native context conversion manifest"); if (WireJson.Text(plan.Value, "phase") == "complete") return ContextRegistry.Read(home).Map(value => new ContextMigrationOutcome(false, value.Bindings.Count));
            var files = plan.Value.GetProperty("files").EnumerateArray().ToArray(); var listed = files.Select(file => WireJson.Text(file, "name")!).ToHashSet(StringComparer.Ordinal); if (Obsolete(home).Any(name => !listed.Contains(name))) throw new InvalidDataException("Context conversion manifest omits retained native metadata");
            var archive = PrivateFiles.Directory(Path.Combine(Path.GetDirectoryName(manifest)!, "originals")); if (!PrivateFiles.Exists(manifest)) PrivateFiles.Write(manifest, WireJson.Bytes(plan.Value, true), Maximum);
            foreach (var file in files)
            {
                var name = WireJson.Text(file, "name")!; var source = Path.Combine(home, name); var saved = Path.Combine(archive, name); var bytes = PrivateFiles.Read(PrivateFiles.Exists(source) ? source : saved, Maximum); var digest = WireJson.Text(file, "digest"); if (Digest(bytes) != digest) throw new InvalidDataException("Native metadata changed since migration preparation; originals were not replaced");
                if (PrivateFiles.Exists(saved)) { if (Digest(PrivateFiles.Read(saved, Maximum)) != digest) throw new InvalidDataException("Native archive failed exact-byte verification"); } else PrivateFiles.Write(saved, bytes, Maximum);
                if (WireJson.Text(file, "target") is { } target) { var path = Path.Combine(home, target); if (PrivateFiles.Exists(path)) { if (Digest(PrivateFiles.Read(path, Maximum)) != digest) throw new InvalidDataException("Canonical receipt conflicts with the verified conversion; no receipt was overwritten"); } else PrivateFiles.Write(path, bytes, Maximum); }
            }
            var registry = Value(ContextRegistry.Decode(plan.Value.GetProperty("registry"))); var current = Path.Combine(home, ContextRegistry.FileName); if (PrivateFiles.Exists(current) && WireJson.Compact(ContextRegistry.Encode(Value(ContextRegistry.Decode(WireJson.Parse(PrivateFiles.Read(current, Maximum)))))) != WireJson.Compact(ContextRegistry.Encode(registry))) throw new InvalidDataException("Canonical registry conflicts with the verified conversion"); Value(ContextRegistry.Write(home, registry));
            foreach (var file in files) { var path = Path.Combine(home, WireJson.Text(file, "name")!); if (PrivateFiles.Exists(path)) { if (Digest(PrivateFiles.Read(path, Maximum)) != WireJson.Text(file, "digest")) throw new InvalidDataException("Original metadata changed before retirement"); PrivateFiles.DeletePrivate(path); } }
            var completed = WireJson.Object(writer => { foreach (var field in plan.Value.EnumerateObject()) { if (field.Name == "phase") writer.WriteString("phase", "complete"); else field.WriteTo(writer); } }); PrivateFiles.Write(manifest, WireJson.Bytes(completed, true), Maximum); Value(ContextRegistry.Read(home)); return Result<ContextMigrationOutcome>.Success(new(true, registry.Bindings.Count));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or KeyNotFoundException) { return Results.Fail<ContextMigrationOutcome>("invalid", "Native context conversion did not complete: " + error.Message); }
        finally { foreach (var ownership in Enumerable.Reverse(locks)) ownership.Dispose(); }
    }
}
