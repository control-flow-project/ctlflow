using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterToml;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static partial class CodexRuntime
{
    private static readonly string[] SettingNames = ["model", "model_reasoning_effort", "sandbox_mode", "approval_policy", "dangerously_bypass_approvals_and_sandbox"];
    public static OwnedRuntimeAdapter Create(string binary = "codex", string? host = null)
        => new(Configured, Validate, (input, cancellation) => Inspect(binary, host ?? ManagedHome.Host, input, cancellation),
            ContextRegistry.Saved, input => Reset(host ?? ManagedHome.Host, input), (input, cancellation) => Start(binary, host ?? ManagedHome.Host, input, cancellation));

    private static IReadOnlyList<RuntimeSetting> Configured(JsonElement input)
        => input.ValueKind == JsonValueKind.Object ? SettingNames.Where(name => input.TryGetProperty(name, out _)).Select(name =>
            new RuntimeSetting(name, input.GetProperty(name).ValueKind == JsonValueKind.String ? input.GetProperty(name).GetString() : input.GetProperty(name).GetRawText(), null)).ToArray() : [];
    private static Result<ValidatedRuntime> Validate(JsonElement input)
        => CodexSettings.Parse(input).Map(value => new ValidatedRuntime(value.Native(), value.ApprovalPolicy == "never" ? RuntimeApproval.None : RuntimeApproval.Listener));

    private static async ValueTask<Result<OwnedRuntimeConnection>> Start(string binary, string host, OwnedRuntimeInput input, CancellationToken cancellation)
    {
        var parsed = CodexSettings.Parse(input.Options); if (!parsed.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(parsed.Error);
        if (!Profile().IsMatch(input.Profile) || input.Name.Length is < 1 or > 200 || !Enum.IsDefined(input.HistoryMode))
            return Results.Fail<OwnedRuntimeConnection>("invalid", "Native tools require the immutable controller-assigned profile, agent name and valid history mode");
        OwnedProcess? process = null; var retained = false;
        try
        {
            cancellation.ThrowIfCancellationRequested(); ManagedHome.Directories(input.Workspace, input.StateDirectory);
            var home = ManagedHome.Prepare(input.StateDirectory, host); if (!home.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(home.Error);
            var started = await OwnedProcess.Start(home.Value, input.Workspace, input.StateDirectory, input.Profile, binary, parsed.Value.Questions == true, host, cancellation);
            if (!started.IsSuccess) return Result<OwnedRuntimeConnection>.Fail(started.Error); process = started.Value;
            if (input.Options.TryGetProperty("dangerously_bypass_approvals_and_sandbox", out var bypass))
            {
                var observe = input.Hooks.Observe; var configured = bypass.GetRawText();
                input = input with { Hooks = input.Hooks with { Observe = value => observe?.Invoke(value is NativeState state
                    ? state with { Settings = [.. state.Settings, new("dangerously_bypass_approvals_and_sandbox", configured, null)] } : value) } };
            }
            var result = await CodexHistories.Start(process, input with { Options = input.Options.Clone() }, parsed.Value, home.Value, cancellation);
            retained = result.IsSuccess; return result;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or OperationCanceledException)
        { return Results.Fail<OwnedRuntimeConnection>("native", "Cannot start the exact owned Codex runtime: " + error.Message); }
        finally { if (!retained && process is not null) await process.DisposeAsync(); }
    }

    private static async ValueTask<Result<Unit>> Inspect(string binary, string host, RuntimeInspectionInput input, CancellationToken cancellation)
    {
        var parsed = CodexSettings.Parse(input.Options); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error);
        string? directory = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); ManagedHome.Directories(input.Workspace, input.StateDirectory);
            var home = ManagedHome.Prepare(input.StateDirectory, host); if (!home.IsSuccess) return Result<Unit>.Fail(home.Error);
            var configuration = ManagedHome.ReadConfiguration(home.Value); if (!configuration.IsSuccess) return Result<Unit>.Fail(configuration.Error);
            var provider = ManagedHome.Provider(configuration.Value); if (!provider.IsSuccess) return Result<Unit>.Fail(provider.Error);
            if (provider.Value.Settings.TryGetValue("env_key", out var key) && (key is not string name || !EnvironmentKey().IsMatch(name) || string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name))))
                return Results.Fail<Unit>("invalid", "The configured native model provider requires its API-key environment variable; configure it privately before fleet setup");
            if (provider.Value.Id == "openai" || provider.Value.Settings.GetValueOrDefault("requires_openai_auth") is true)
            {
                var login = await NativeProcess.Capture(new(binary, ["login", "status"], input.Workspace, ManagedHome.NativeEnvironment(host, input.StateDirectory)), 65536, 10000, cancellation);
                if (!login.IsSuccess || login.Value.ExitCode != 0) return Results.Fail<Unit>("unauthorized", "Sign in with codex login using the host CODEX_HOME, then repeat fleet setup or resume. Never paste credentials into chat.");
            }
            directory = PrivateFiles.Directory(Path.Combine(input.StateDirectory, ".codex-inspection-" + Identity.Identifier()));
            var text = ConfigurationToml.Format(configuration.Value); if (!text.IsSuccess) return Result<Unit>.Fail(text.Error);
            PrivateFiles.Write(Path.Combine(directory, "config.toml"), Encoding.UTF8.GetBytes(text.Value), ConfigurationToml.MaximumBytes);
            var started = await OwnedProcess.Start(directory, input.Workspace, input.StateDirectory, "crossfire-inspection", binary, parsed.Value.Questions == true, host, cancellation);
            if (!started.IsSuccess) return Result<Unit>.Fail(started.Error); await using var process = started.Value;
            var connected = await WebSocketProtocol.Open(process.Endpoint, process.Token, 10000,
                new(_ => { }, (_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("invalid", "Capability inspection cannot answer native decisions")), _ => { }), cancellation);
            if (!connected.IsSuccess) return Result<Unit>.Fail(connected.Error); await using var protocol = connected.Value;
            var initialized = CodexJson.ObjectReply(await protocol.Request("initialize", CodexJson.Object(writer =>
            { writer.WriteStartObject("clientInfo"); writer.WriteString("name", "crossfire-inspection"); writer.WriteString("version", "0.1.22"); writer.WriteEndObject(); writer.WriteStartObject("capabilities"); writer.WriteBoolean("experimentalApi", true); writer.WriteEndObject(); }), cancellation));
            if (!initialized.IsSuccess) return Result<Unit>.Fail(initialized.Error); var notified = await protocol.Notify("initialized", cancellation); if (!notified.IsSuccess) return notified;
            return (await ModelAdmission.Read(protocol, parsed.Value, cancellation)).Map(_ => default(Unit));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or OperationCanceledException)
        { return Results.Fail<Unit>("native", "Cannot inspect native Codex prerequisites: " + error.Message); }
        finally { if (directory is not null) Directory.Delete(directory, recursive: true); }
    }
    private static Result<Unit> Reset(string host, RuntimeResetInput input)
    {
        if (!Validation.Identifier(input.ResetId)) return Results.Fail<Unit>("invalid", "Invalid native context reset identity");
        try
        {
            ManagedHome.Directories(input.Workspace, input.StateDirectory); var prepared = ManagedHome.Prepare(input.StateDirectory, host); if (!prepared.IsSuccess) return Result<Unit>.Fail(prepared.Error);
            var home = prepared.Value; using var stateLock = new StateLock(Path.Combine(home, "owner"));
            var loaded = ContextRegistry.Read(home); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var marker = Path.Combine(home, "crossfire-reset.json");
            if (PrivateFiles.Exists(marker))
            {
                using var document = JsonDocument.Parse(PrivateFiles.Read(marker, 65536));
                if (!Validation.Fields(document.RootElement, ["resetId"]).IsSuccess || !Validation.Identifier(CodexJson.String(document.RootElement, "resetId") ?? "")) return Results.Fail<Unit>("invalid", "Invalid saved native reset identity");
                if (CodexJson.String(document.RootElement, "resetId") == input.ResetId) return Results.Done();
            }
            StateArchive.Move(home, Path.Combine(home, "crossfire-archive", input.ResetId), name => name == ContextRegistry.FileName || name.StartsWith(ContextRegistry.FileName + ".", StringComparison.Ordinal));
            var state = CodexJson.Object(writer => writer.WriteString("resetId", input.ResetId)); PrivateFiles.Write(marker, Encoding.UTF8.GetBytes(state.GetRawText()), 65536); return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("native", "Native context reset could not preserve its private archive: " + error.Message); }
    }
    [GeneratedRegex("\\A[a-z][a-z0-9-]{0,39}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex Profile();
    [GeneratedRegex("\\A[A-Za-z_][A-Za-z0-9_]*\\z", RegexOptions.CultureInvariant)]
    private static partial Regex EnvironmentKey();
}
