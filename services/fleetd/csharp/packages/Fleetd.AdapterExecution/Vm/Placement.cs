using System.Net;
using System.Net.Sockets;
using System.Text;
using Crossfire.Contracts;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.Kernel;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution.Vm;

public static class Placement
{
    public static NativePlacement Create(FleetConfiguration configuration, FleetInstance instance, int? listenerPort)
        => new((native, cancellation) => Open(configuration, instance, listenerPort, native, cancellation));
    private static async ValueTask<Result<NativeLease>> Open(FleetConfiguration configuration, FleetInstance instance,
        int? listenerPort, NativeLeaseRequest native, CancellationToken cancellation)
    {
        Session? session = null; string? created = null;
        try
        {
            cancellation.ThrowIfCancellationRequested();
            var id = Identity.Identifier(); created = id; ExecutionFiles.Create(id);
            var directory = ExecutionFiles.Runtime(id);
            var request = new VmRequest(id, directory, configuration.Directory, instance.Key, configuration.Digest, native, listenerPort);
            var selection = request.Select(); request.Write();
            NativeOwnership.Prepare(native.Directory, native.Workspace, native.Home);
            var budgetDirectory = PrivateFiles.Directory(VmBudgetFiles.ForFleet(configuration.Directory));
            var admitted = await Budget.Open(configuration.Directory, budgetDirectory, selection.Catalog, selection.Profile, cancellation);
            if (!admitted.IsSuccess) return Result<NativeLease>.Fail(admitted.Error);
            using (admitted.Value)
            {
                var reserved = admitted.Value.Reserve(request.Id); if (!reserved.IsSuccess) return Result<NativeLease>.Fail(reserved.Error);
                var executable = Environment.ProcessPath ?? throw new IOException("VM supervisor requires the installed fleetd executable");
                var environment = new Dictionary<string, string?>();
                foreach (var key in new[] { "DOTNET_ROOT", "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "CODEX_HOME", "PI_CODING_AGENT_DIR" })
                    if (Environment.GetEnvironmentVariable(key) is { } value) environment[key] = value;
                var service = Resources.Service(configuration.Directory, request.Id, selection.Catalog.MemoryBudgetMiB, selection.Profile,
                    new(executable, [Supervisor.Mode, request.File], directory, environment, true));
                if (!service.IsSuccess) return Result<NativeLease>.Fail(service.Error);
                session = new(request, service.Value);
                await session.Expect("admitted", 30, cancellation);
            }
            await session.Expect("ready", 240, cancellation);
            var owned = session; session = null; created = null;
            return Result<NativeLease>.Success(new(owned.Execution, owned.DisposeAsync));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or OperationCanceledException or TimeoutException)
        { return Results.Fail<NativeLease>("native", "Cannot open the selected VM execution: " + error.Message); }
        finally
        {
            if (session is not null) { await session.DisposeAsync(); created = null; }
            if (created is not null) ExecutionFiles.Remove(created);
        }
    }
}

internal sealed class Session : IAsyncDisposable
{
    private readonly VmRequest request;
    private readonly SemaphoreSlim forwarding = new(1, 1);
    private readonly Dictionary<int, int> ports = [];
    private readonly object gate = new();
    private Task? closing;
    public NativeExecution Execution { get; }
    // The supervisor's stdout is its control protocol, not a drained log stream.
    private readonly NativeProcess process;
    private readonly Task errors;
    private string errorTail = "";
    public Session(VmRequest request, NativeCommand command)
    {
        this.request = request;
        var opened = NativeProcess.Start(command); if (!opened.IsSuccess) throw new IOException(opened.Error.Message);
        process = opened.Value; errors = Errors();
        Execution = new(command => SshCommands.Place(request.Directory, request.Id, command), Endpoint, new(request.Directory, request.Id));
    }
    private async Task Errors()
    {
        var buffer = new char[4096];
        for (;;)
        {
            var count = await process.Errors.ReadAsync(buffer); if (count == 0) return;
            lock (gate) { errorTail += new string(buffer, 0, count); if (errorTail.Length > 16384) errorTail = errorTail[^16384..]; }
        }
    }
    public async Task Expect(string expected, int seconds, CancellationToken cancellation)
    {
        var line = await process.Output.ReadLineAsync(cancellation).AsTask().WaitAsync(TimeSpan.FromSeconds(seconds), cancellation);
        if (line is null)
        {
            await errors.WaitAsync(TimeSpan.FromSeconds(2), cancellation);
            throw new IOException("VM supervisor did not report " + expected + ": " + errorTail);
        }
        if (Encoding.UTF8.GetByteCount(line) > 65536) throw new IOException("VM supervisor status exceeds its bound");
        var value = WireJson.Parse(Encoding.UTF8.GetBytes(line));
        var phase = WireJson.Text(value, "state");
        if (!Validation.Fields(value, phase == "failed" ? ["id", "state", "error"] : ["id", "state"]).IsSuccess
            || WireJson.Text(value, "id") != request.Id) throw new IOException("Invalid VM supervisor status identity or fields");
        if (phase == "failed") throw new IOException(WireJson.Text(value, "error") ?? "VM supervisor failed");
        if (phase != expected) throw new IOException("Invalid VM supervisor status sequence");
    }
    private async ValueTask<Result<string>> Endpoint(string endpoint, CancellationToken cancellation)
    {
        const string prefix = "ws://127.0.0.1:";
        if (!endpoint.StartsWith(prefix, StringComparison.Ordinal)
            || !int.TryParse(endpoint.AsSpan(prefix.Length), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var guestPort) || guestPort is < 1 or > 65535)
            return Results.Fail<string>("native", "Native VM endpoint must be its own loopback WebSocket port");
        await forwarding.WaitAsync(cancellation);
        try
        {
            lock (gate) if (closing is not null) return Results.Fail<string>("native", "VM execution is closing");
            if (!ports.TryGetValue(guestPort, out var port))
            {
                for (var attempt = 0; attempt < 3; attempt++)
                {
                    var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
                    var command = SshCommands.Forward(request.Directory, request.Id, port, guestPort);
                    if (!command.IsSuccess) return Result<string>.Fail(command.Error);
                    var result = await NativeProcess.Capture(command.Value, 8192, 10000, cancellation);
                    if (!result.IsSuccess) return Result<string>.Fail(result.Error);
                    if (result.Value.ExitCode != 0) continue;
                    ports.Add(guestPort, port); break;
                }
                if (!ports.ContainsKey(guestPort)) return Results.Fail<string>("native", "Cannot forward the exact guest native endpoint");
            }
            return Result<string>.Success("ws://127.0.0.1:" + port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        finally { forwarding.Release(); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Close(completion); return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        try
        {
            try { await process.Input.WriteLineAsync("close"); await process.Input.FlushAsync(); process.Input.Close(); }
            catch (Exception error) when (error is IOException or InvalidOperationException or ObjectDisposedException) { }
            try { await process.Ended.WaitAsync(TimeSpan.FromSeconds(30)); }
            catch (TimeoutException)
            {
                var closed = await NativeProcess.Capture(new("/usr/bin/systemctl", ["--user", "stop", request.Unit], request.Directory,
                    new Dictionary<string, string?>()), 8192, 30000, CancellationToken.None);
                if (!closed.IsSuccess || closed.Value.ExitCode != 0) throw new IOException("Cannot stop the exact VM service; ownership remains fenced");
                await process.Ended.WaitAsync(TimeSpan.FromSeconds(10));
            }
            await errors;
            ExecutionState.RemoveClosed(request.Native.Directory, request.Id);
            Budget.Remove(VmBudgetFiles.ForFleet(request.Fleet), request.Id);
            foreach (var file in new[] { request.Ready, request.Ready + ".close" }) if (PrivateFiles.Exists(file)) PrivateFiles.DeletePrivate(file);
            await process.DisposeAsync(); ExecutionFiles.Remove(request.Id); completion.TrySetResult();
        }
        catch (Exception error) { completion.TrySetException(error); }
    }
}
