using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public static partial class PiRuntime
{
    public static OwnedRuntimeAdapter Create(string binary = "pi", string? host = null)
        => new(Configured, value => PiValues.Options(value).Map(_ => new ValidatedRuntime(value.Clone(), RuntimeApproval.None)),
            (input, cancellation) => Inspect(binary, host ?? PiValues.Host, input, cancellation), Saved, Reset,
            (input, cancellation) => Start(binary, host ?? PiValues.Host, input, cancellation));
    private static IReadOnlyList<RuntimeSetting> Configured(JsonElement input)
        => input.ValueKind == JsonValueKind.Object ? new[] { "provider", "model", "thinking_level" }.Where(name => input.TryGetProperty(name, out _))
            .Select(name => new RuntimeSetting(name, PiValues.Text(input, name), null)).ToArray() : [];
    private static void Directories(string workspace, string state)
    { PrivateFiles.ExistingDirectory(workspace, false); PrivateFiles.ExistingDirectory(state, true); }
    private static string Home(string workspace, string state)
    { Directories(workspace, state); return PrivateFiles.Directory(Path.Combine(state, ".pi")); }
    private static async ValueTask<Result<OwnedRuntimeConnection>> Start(string binary, string host, OwnedRuntimeInput input, CancellationToken cancellation)
    {
        var parsed = PiValues.Options(input.Options); if (!parsed.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(parsed.Error);
        if (!Profile().IsMatch(input.Profile) || input.Name.Length is < 1 or > 200 || !Enum.IsDefined(input.HistoryMode)) return Results.Fail<OwnedRuntimeConnection>("invalid", "Native Pi requires the immutable controller-assigned profile, agent name and valid history mode");
        StateLock? stateLock = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); var home = Home(input.Workspace, input.StateDirectory); stateLock = new(Path.Combine(home, "owner"));
            var refreshed = PiValues.Refresh(home, host); if (!refreshed.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(refreshed.Error);
            var owned = stateLock; stateLock = null; return await PiHistories.Start(binary, home, owned, input with { Options = input.Options.Clone() }, parsed.Value, cancellation);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException or OperationCanceledException)
        { return Results.Fail<OwnedRuntimeConnection>("native", "Cannot start the exact owned Pi runtime: " + PiValues.ErrorText(error.Message)); }
        finally { stateLock?.Dispose(); }
    }
    private static async ValueTask<Result<Unit>> Inspect(string binary, string host, RuntimeInspectionInput input, CancellationToken cancellation)
    {
        var parsed = PiValues.Options(input.Options); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error); string? directory = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); Directories(input.Workspace, input.StateDirectory); directory = PrivateFiles.Directory(Path.Combine(input.StateDirectory, ".pi-inspection-" + Identity.Identifier()));
            var selected = await Start(binary, host, new("crossfire-inspection", "crossfire-inspection", input.Workspace, directory,
                "Capability inspection only. No model work is authorized.", input.Options,
                new((_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("forbidden", "Capability inspection cannot answer native decisions"))), AllowNewHistory: true), cancellation);
            if (!selected.IsSuccess) return Result<Unit>.Fail(selected.Error); await using var owner = selected.Value; return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException or OperationCanceledException)
        { return Results.Fail<Unit>("native", "Cannot inspect native Pi prerequisites: " + PiValues.ErrorText(error.Message)); }
        finally { if (directory is not null) Directory.Delete(directory, recursive: true); }
    }
    private static Result<IReadOnlyList<SavedRuntimeContext>> Saved(string workspace, string state)
    {
        try
        {
            var home = Home(workspace, state); var loaded = PiState.Read(home); if (!loaded.IsSuccess) return Result<IReadOnlyList<SavedRuntimeContext>>.Fail(loaded.Error); var saved = new List<SavedRuntimeContext>();
            foreach (var binding in loaded.Value.Bindings) { var inspected = PiState.ReadBinding(home, binding, workspace, false); if (!inspected.IsSuccess) return Result<IReadOnlyList<SavedRuntimeContext>>.Fail(inspected.Error);
                if (inspected.Value.SessionId is { } id) saved.Add(new(binding.Context, "pi", id, workspace)); } return Result<IReadOnlyList<SavedRuntimeContext>>.Success(saved);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<IReadOnlyList<SavedRuntimeContext>>("invalid", "Cannot inspect exact saved Pi histories: " + PiValues.ErrorText(error.Message)); }
    }
    private static Result<Unit> Reset(RuntimeResetInput input)
    {
        if (!Validation.Identifier(input.ResetId)) return Results.Fail<Unit>("invalid", "Invalid Pi context reset identity");
        try
        {
            var home = Home(input.Workspace, input.StateDirectory); using var stateLock = new StateLock(Path.Combine(home, "owner"));
            var loaded = PiState.Read(home); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var marker = Path.Combine(home, "crossfire-reset.json");
            if (PrivateFiles.Exists(marker))
            {
                using var document = JsonDocument.Parse(PrivateFiles.Read(marker, 65536));
                if (!Validation.Fields(document.RootElement, ["resetId"]).IsSuccess || !Validation.Identifier(PiValues.Text(document.RootElement, "resetId") ?? "")) return Results.Fail<Unit>("invalid", "Invalid saved Pi reset identity");
                if (PiValues.Text(document.RootElement, "resetId") == input.ResetId) return Results.Done();
            }
            StateArchive.Move(home, Path.Combine(home, "archive", input.ResetId), name => name is PiState.FileName or "histories" or "receipts");
            PrivateFiles.Write(marker, Encoding.UTF8.GetBytes(PiValues.Object(writer => writer.WriteString("resetId", input.ResetId)).GetRawText()), 65536); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("native", "Pi reset could not preserve the exact private archive: " + PiValues.ErrorText(error.Message)); }
    }
    [GeneratedRegex("\\A[a-z][a-z0-9-]{0,39}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex Profile();
}
