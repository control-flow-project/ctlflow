using System.ComponentModel;
using System.Diagnostics;
using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;

namespace Fleet.SshTransport;

public sealed class SshTunnel : IAsyncDisposable
{
    private readonly string directory;
    private readonly Process process;
    private CancellationTokenRegistration cancel;
    private readonly object gate = new();
    private Task? closing;
    public string Socket { get; }
    private SshTunnel(string directory, Process process)
    {
        this.directory = directory; this.process = process; Socket = Path.Combine(directory, "daemon.sock");
    }
    private void Arm(CancellationToken cancellation)
    { var registration = cancellation.Register(() => _ = DisposeAsync()); lock (gate) { if (closing is null) cancel = registration; else registration.Unregister(); } }
    public static bool ValidHost(string host)
    {
        var parts = host.Split('@'); return parts.Length is 1 or 2 && parts.All(part => part.Length != 0 && char.IsAsciiLetterOrDigit(part[0]) && part.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '.' or '-'));
    }
    public static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    public static string Terminal(string host, string command)
        => ValidHost(host) ? string.Join(' ', new[] { "ssh", "-t", "-o", "StrictHostKeyChecking=yes", host, command }.Select(Quote)) : throw new ArgumentException("Use an SSH hostname or user@hostname from your SSH configuration");
    public static async ValueTask<Result<SshTunnel>> Open(string host, string root, TimeProvider clock, CancellationToken cancellation)
    {
        if (!OperatingSystem.IsLinux()) return Results.Fail<SshTunnel>("invalid", "The owned native SSH transport requires Linux");
        if (!ValidHost(host) || !Path.IsPathFullyQualified(root) || root.Contains(':') || root.Any(char.IsControl)) return Results.Fail<SshTunnel>("invalid", "Use a configured SSH hostname and an absolute remote Unix root without colon or control characters");
        cancellation.ThrowIfCancellationRequested(); var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "fleet-ssh-" + Identity.Identifier())); var socket = Path.Combine(directory, "daemon.sock");
        var start = new ProcessStartInfo("ssh") { UseShellExecute = false, WorkingDirectory = directory };
        foreach (var argument in new[] { "-N", "-T", "-o", "ExitOnForwardFailure=yes", "-o", "StrictHostKeyChecking=yes", "-o", "StreamLocalBindUnlink=no", "-L", socket + ":" + Path.Combine(root, "fleetd.sock"), host }) start.ArgumentList.Add(argument);
        Process process; try { process = Process.Start(start) ?? throw new IOException("SSH process was not created"); } catch (Exception error) when (error is IOException or Win32Exception) { Directory.Delete(directory); return Results.Fail<SshTunnel>("unavailable", "Cannot open the configured SSH transport: " + error.Message); } var tunnel = new SshTunnel(directory, process); tunnel.Arm(cancellation);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(120), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        try
        {
            while (!PrivateFiles.Exists(socket)) { if (process.HasExited) { await tunnel.DisposeAsync(); return Results.Fail<SshTunnel>("unavailable", "SSH tunnel ended before its private socket became ready"); } await Task.Delay(TimeSpan.FromMilliseconds(50), clock, scope.Token); }
            File.SetUnixFileMode(socket, UnixFileMode.UserRead | UnixFileMode.UserWrite); PrivateFiles.UnixSocket(socket); return Result<SshTunnel>.Success(tunnel);
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or InvalidOperationException) { await tunnel.DisposeAsync(); return Results.Fail<SshTunnel>("unavailable", "SSH forwarding did not become ready: " + error.Message); }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected; lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; } if (completion is not null) _ = Finish(completion); return new(selected);
        async Task Finish(TaskCompletionSource result) { try { await Close(); result.TrySetResult(); } catch (Exception error) { result.TrySetException(error); } }
    }
    private async Task Close()
    {
        cancel.Unregister(); try { if (!process.HasExited) process.Kill(entireProcessTree: true); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); } finally { process.Dispose(); if (File.Exists(Socket)) File.Delete(Socket); Directory.Delete(directory); }
    }
}
