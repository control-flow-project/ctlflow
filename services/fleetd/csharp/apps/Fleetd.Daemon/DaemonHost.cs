using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterPi;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.AdapterExecution;
using Fleetd.Domain;
using Fleetd.Storage;
using Microsoft.Extensions.Logging;

namespace Fleetd.Daemon;

public static class DaemonHost
{
    public static async Task Run(string[] arguments)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("The owned fleet controller requires Linux");
        var options = new Dictionary<string, string>(StringComparer.Ordinal); var background = false; var migrate = false; for (var index = 0; index < arguments.Length; index++) { var key = arguments[index]; if (key == "--background" && !background) { background = true; continue; } if (key == "--migrate-contexts" && !migrate) { migrate = true; continue; } if (key is not ("--root" or "--name" or "--artifacts") || index + 1 >= arguments.Length || !options.TryAdd(key, arguments[++index])) throw new ArgumentException("fleetd --root ABSOLUTE_DIRECTORY [--name NAME] [--artifacts RELEASE_DIRECTORY] [--migrate-contexts]"); }
        if (background) Crossfire.AdapterProcess.BackgroundStdio.RedirectToNull();
        if (!options.TryGetValue("--root", out var root) || !Path.IsPathFullyQualified(root) || root != Path.GetFullPath(root) || Encoding.UTF8.GetByteCount(Path.Combine(root, "fleetd.sock")) > 100) throw new ArgumentException("Use an exact absolute controller root short enough for its private Unix socket");
        if (migrate) { if (background || options.ContainsKey("--name") || options.ContainsKey("--artifacts")) throw new ArgumentException("Context migration retains identity and software; supply only --root and --migrate-contexts"); ControllerContextMigration.Run(root); return; }
        if (PrivateFiles.Exists(root)) PrivateFiles.ExistingDirectory(root, true); else PrivateFiles.Directory(root); using var ownership = new StateLock(Path.Combine(root, "daemon")); var selected = options.GetValueOrDefault("--name"); var identityFile = Path.Combine(root, "controller.json"); ControllerIdentity identity;
        if (PrivateFiles.Exists(identityFile)) { identity = ParseController(AgentIO.Read(Crossfire.AdapterCrossfire.AgentState.Port, identityFile)); if (selected is not null && identity.Name != selected) throw new InvalidDataException("Controller root is already named differently"); }
        else { identity = ParseController(WireJson.Object(writer => writer.WriteString("name", selected ?? "local"))); AgentIO.Write(Crossfire.AdapterCrossfire.AgentState.Port, identityFile, Fleetd.Contracts.FleetWire.Controller(identity)); }
        var retention = RegistryFiles.LoggingDays(root); if (!retention.IsSuccess) throw new InvalidDataException(retention.Error.Message); var clock = TimeProvider.System; using var diagnostics = new DiagnosticStore(Path.Combine(root, "logs"), retention.Value, () => clock.GetUtcNow().ToUnixTimeMilliseconds());
        var converted = await DiagnosticStore.Migrate(Path.Combine(root, "daemon.log"), Path.Combine(root, "logs"), retention.Value, () => clock.GetUtcNow().ToUnixTimeMilliseconds()); if (!converted.IsSuccess) throw new IOException(converted.Error.Message);
        var socket = Path.Combine(root, "fleetd.sock"); await PrivateSockets.RemoveStale(socket, CancellationToken.None); var release = Path.GetFullPath(options.GetValueOrDefault("--artifacts") ?? Path.Combine(AppContext.BaseDirectory, "artifacts"));
        await using var execution = new ExecutionHost(new Dictionary<string, OwnedRuntimeAdapter>(StringComparer.Ordinal) { ["codex"] = CodexRuntime.Create(), ["pi"] = PiRuntime.Create() }, release, diagnostics.Write, clock);
        var registry = new RegistryFiles(root); var created = FleetController.Create(registry.Port, execution.Port, identity, clock); if (!created.IsSuccess) throw new InvalidDataException(created.Error.Message); await using var controller = created.Value;
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ApplicationName = typeof(DaemonHost).Assembly.GetName().Name }); builder.Logging.ClearProviders(); builder.WebHost.ConfigureKestrel(server => { server.ListenUnixSocket(socket); server.Limits.MaxRequestBodySize = 1048576; server.Limits.MaxRequestHeadersTotalSize = 8192; server.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); server.Limits.MaxConcurrentConnections = 128; });
        await using var app = builder.Build(); app.Run(http => DaemonApi.Handle(controller, () => (retention.Value, diagnostics.Error), app.Lifetime.StopApplication, http)); using var cleanup = new CancellationTokenSource();
        var logging = Maintain(); async Task Maintain()
        {
            try { while (!cleanup.IsCancellationRequested) { var files = diagnostics.Prune(); var records = controller.MaintainHistory(retention.Value); diagnostics.MaintenanceError(!files.IsSuccess ? files.Error.Message : !records.IsSuccess ? records.Error.Message : null); await Task.Delay(TimeSpan.FromMilliseconds(!files.IsSuccess || !records.IsSuccess || records.Value ? 5000 : 3600000), clock, cleanup.Token); } } catch (OperationCanceledException) when (cleanup.IsCancellationRequested) { }
        }
        using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; app.Lifetime.StopApplication(); }); using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; app.Lifetime.StopApplication(); }); using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, context => { context.Cancel = true; app.Lifetime.StopApplication(); });
        IDisposable? socketOwnership = null; try
        {
            await app.StartAsync(); System.IO.File.SetUnixFileMode(socket, UnixFileMode.UserRead | UnixFileMode.UserWrite); socketOwnership = PrivateSockets.Own(socket); diagnostics.Write("Fleet controller ready: " + identity.Name); Console.WriteLine(WireJson.Compact(WireJson.Object(writer => { writer.WriteString("status", "ready"); writer.WritePropertyName("controller"); Fleetd.Contracts.FleetWire.Controller(identity).WriteTo(writer); writer.WriteString("socket", socket); }))); await app.WaitForShutdownAsync();
        }
        finally
        {
            try { await cleanup.CancelAsync(); }
            finally { try { await logging; } finally { try { await controller.DisposeAsync(); } finally { try { await execution.DisposeAsync(); } finally { try { await app.StopAsync(); } finally { socketOwnership?.Dispose(); } } } } }
        }
    }
    private static ControllerIdentity ParseController(JsonElement value)
    {
        if (!Validation.Fields(value, ["name"], ["metadata"]).IsSuccess || WireJson.Text(value, "name") is not { Length: >= 1 and <= 100 } name || name.Any(char.IsControl)) throw new InvalidDataException("Invalid controller identity"); Dictionary<string, string>? metadata = null;
        if (value.TryGetProperty("metadata", out var fields)) { if (fields.ValueKind != JsonValueKind.Object || fields.EnumerateObject().Count() > 16) throw new InvalidDataException("Invalid descriptive controller metadata"); metadata = new(StringComparer.Ordinal); foreach (var field in fields.EnumerateObject()) { var text = Validation.Text(field.Value, 256, 0); if (field.Name.Length is < 1 or > 40 || field.Name[0] is < 'a' or > 'z' || !field.Name.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9' or '-') || !text.IsSuccess) throw new InvalidDataException("Invalid descriptive controller metadata"); metadata.Add(field.Name, text.Value); } }
        return new(name, metadata);
    }
}
