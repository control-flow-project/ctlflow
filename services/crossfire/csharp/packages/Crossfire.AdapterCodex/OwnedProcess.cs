using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed partial class OwnedProcess : IAsyncDisposable
{
    private readonly NativeProcess process;
    private readonly StateLock stateLock;
    private readonly Task output;
    private readonly Task errors;
    private readonly CancellationTokenSource stop = new();
    private readonly CancellationTokenRegistration cancellation;
    private readonly object gate = new();
    private readonly TaskCompletionSource<string> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Task? closing;
    public string Endpoint { get; private set; } = "";
    public string Token { get; }
    public string TokenFile { get; }
    public string Binary { get; }
    public string Path { get; }
    public int Id => process.Id;
    public CancellationToken Lifetime { get; }
    public Task Ended { get; }
    private OwnedProcess(NativeProcess process, StateLock stateLock, string token, string tokenFile, string binary, string path, CancellationToken cancellation)
    {
        this.process = process; this.stateLock = stateLock; Token = token; TokenFile = tokenFile; Binary = binary; Path = path; Lifetime = stop.Token;
        output = Pump(process.Output); errors = Pump(process.Errors); Ended = ObserveExit();
        this.cancellation = cancellation.Register(() => { _ = DisposeAsync(); });
    }
    private async Task ObserveExit()
    {
        await process.Ended; ready.TrySetException(new IOException("Owned Codex exited before readiness")); await stop.CancelAsync();
    }
    private async Task Pump(StreamReader reader)
    {
        var buffer = new char[8192]; var tail = "";
        for (;;)
        {
            var count = await reader.ReadAsync(buffer.AsMemory()); if (count == 0) return;
            tail += new string(buffer, 0, count); if (tail.Length > 64000) tail = tail[^64000..];
            var match = Listening().Match(tail); if (match.Success) ready.TrySetResult(match.Groups[1].Value);
        }
    }
    public static async ValueTask<Result<OwnedProcess>> Start(string home, string workspace, string state, string profile, string binary, bool questions, string authenticationHome, CancellationToken cancellation)
    {
        StateLock? stateLock = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); ManagedHome.Directories(workspace, state); PrivateFiles.ExistingDirectory(home, true);
            stateLock = new(System.IO.Path.Combine(home, "owner"));
            var refreshed = ManagedHome.RefreshAuthentication(home, authenticationHome); if (!refreshed.IsSuccess) return Result<OwnedProcess>.Fail(refreshed.Error);
            var started = await Launch(home, workspace, state, profile, binary, questions, stateLock, cancellation);
            if (started.IsSuccess) stateLock = null; return started;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or OperationCanceledException)
        { return Results.Fail<OwnedProcess>("native", "Cannot acquire exclusive native Codex ownership: " + error.Message); }
        finally { stateLock?.Dispose(); }
    }
    private static async ValueTask<Result<OwnedProcess>> Launch(string home, string workspace, string state, string profile, string binary, bool questions, StateLock stateLock, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested(); ManagedHome.Directories(workspace, state); PrivateFiles.ExistingDirectory(home, true);
        var environment = ManagedHome.NativeEnvironment(home, state, profile);
        var version = await NativeProcess.Capture(new(binary, ["--version"], workspace, environment), 4096, 10000, cancellation);
        if (!version.IsSuccess) return Result<OwnedProcess>.Fail(version.Error);
        var supported = CodexSettings.Version(TextRules.Trim(version.Value.Output)); if (version.Value.ExitCode != 0 || !supported.IsSuccess) return Result<OwnedProcess>.Fail(supported.IsSuccess ? new("native", "Cannot inspect native Codex version") : supported.Error);
        var instructions = await InstructionCapability.Inspect(binary, home, workspace, environment, cancellation); if (!instructions.IsSuccess) return Result<OwnedProcess>.Fail(instructions.Error);
        if (questions)
        {
            var listing = await NativeProcess.Capture(new(binary, ["features", "list"], workspace, environment), 65536, 10000, cancellation);
            if (!listing.IsSuccess) return Result<OwnedProcess>.Fail(listing.Error);
            var capability = CodexSettings.QuestionCapability(listing.Value.Output); if (!capability.IsSuccess) return Result<OwnedProcess>.Fail(capability.Error);
            if (listing.Value.ExitCode != 0) return Results.Fail<OwnedProcess>("native", "Cannot inspect native Codex feature support");
        }
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(path) || path.Length > 4096 || path.Any(char.IsControl)) return Results.Fail<OwnedProcess>("invalid", "Codex requires a bounded native executable search path");
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)); var tokenFile = System.IO.Path.Combine(home, ".crossfire-token-" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)));
        PrivateFiles.Write(tokenFile, Encoding.ASCII.GetBytes(token), 64);
        var launched = NativeGuard.Start(new(binary, ["app-server", "--listen", "ws://127.0.0.1:0", "--ws-auth", "capability-token", "--ws-token-file", tokenFile], workspace, environment), home, "codex");
        if (!launched.IsSuccess) { PrivateFiles.DeletePrivate(tokenFile); return Result<OwnedProcess>.Fail(launched.Error); }
        var owner = new OwnedProcess(launched.Value, stateLock, token, tokenFile, binary, path, cancellation);
        try { owner.Endpoint = await owner.ready.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellation); return Result<OwnedProcess>.Success(owner); }
        catch (Exception error) when (error is TimeoutException or IOException or OperationCanceledException)
        { await owner.DisposeAsync(); return Results.Fail<OwnedProcess>("native", "Codex did not become ready in its private owned process"); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Close(completion);
        return new(selected);
    }
    private async Task Close(TaskCompletionSource completion)
    {
        try
        {
            await cancellation.DisposeAsync(); await process.StopAsync(); await Ended; await Task.WhenAll(output, errors);
            await process.DisposeAsync(); PrivateFiles.DeletePrivate(TokenFile); stateLock.Dispose(); stop.Dispose(); completion.TrySetResult();
        }
        catch (Exception error) { completion.TrySetException(error); }
    }
    [GeneratedRegex("^\\s*listening on: (ws://127\\.0\\.0\\.1:[0-9]+)\\s*$", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex Listening();
}
