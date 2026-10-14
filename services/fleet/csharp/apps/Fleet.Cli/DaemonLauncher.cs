using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Client = Fleet.DaemonClient.DaemonClient;
using static Fleet.Cli.CommandValues;

namespace Fleet.Cli;

public static partial class DaemonLauncher
{
    public static string ReleaseDirectory => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "fleetd", "artifacts"));
    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Kill(int process, int signal);
    [LibraryImport("libc", EntryPoint = "getpgid", SetLastError = true)]
    private static partial int Group(int process);
    public static async ValueTask<JsonElement> Launch(string root, string? name, TimeProvider clock, CancellationToken cancellation)
    {
        Prepare(root); using var scope = new CancellationTokenSource(TimeSpan.FromSeconds(65), clock); using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, scope.Token); StateLock? ownership = null;
        try
        {
            while (ownership is null) { linked.Token.ThrowIfCancellationRequested(); try { ownership = new(Path.Combine(root, "launcher")); } catch (IOException) { await Task.Delay(TimeSpan.FromMilliseconds(100), clock, linked.Token); } }
            using var client = new Client(Path.Combine(root, "fleetd.sock")); var previous = await Call(client, "status", linked.Token);
            if (previous.IsSuccess) { ValidateStatus(previous.Value, name); return previous.Value; } if (previous.Error.Code != "unavailable") throw new CommandFailure(previous.Error.Message);
            var executable = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "fleetd", "fleetd")); PrivateFiles.Executable(executable); var start = new ProcessStartInfo("/usr/bin/setsid") { UseShellExecute = false, WorkingDirectory = root, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var item in new[] { "--", executable, "--root", root, "--artifacts", ReleaseDirectory, "--background" }) start.ArgumentList.Add(item); if (name is not null) { start.ArgumentList.Add("--name"); start.ArgumentList.Add(name); }
            using var process = Process.Start(start) ?? throw new CommandFailure("Cannot start the installed native fleet controller"); process.StandardInput.Close(); process.StandardOutput.Close(); process.StandardError.Close(); var ready = false;
            try
            {
                for (;;)
                {
                    linked.Token.ThrowIfCancellationRequested(); var status = await Call(client, "status", linked.Token); if (status.IsSuccess) { ValidateStatus(status.Value, name); ready = true; return status.Value; }
                    if (status.Error.Code != "unavailable" || process.HasExited) throw new CommandFailure("Controller did not become ready; inspect " + Path.Combine(root, "logs")); await Task.Delay(TimeSpan.FromMilliseconds(100), clock, linked.Token);
                }
            }
            finally { if (!ready) await Terminate(process); }
        }
        catch (Exception error) when (error is Win32Exception or OperationCanceledException) { throw new CommandFailure("Controller launch did not complete: " + error.Message); }
        finally { ownership?.Dispose(); }
    }
    private static void Prepare(string root)
    {
        if (!Path.IsPathFullyQualified(root) || root != Path.GetFullPath(root) || Encoding.UTF8.GetByteCount(Path.Combine(root, "fleetd.sock")) > 100) throw new CommandFailure("Use an exact absolute controller root short enough for its Unix socket"); if (PrivateFiles.Exists(root)) PrivateFiles.ExistingDirectory(root, true); else PrivateFiles.Directory(root);
    }
    private static void ValidateStatus(JsonElement status, string? name)
    { var controller = status.GetProperty("controller"); if (name is not null && Text(controller, "name") != name || Boolean(status, "stopping")) throw new CommandFailure("Selected controller has another identity or is stopping"); }
    private static async Task Terminate(Process process)
    {
        if (process.HasExited) return; if (Group(process.Id) == process.Id) { if (Kill(-process.Id, 15) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Cannot terminate the failed controller launch"); } else if (!process.HasExited) process.Kill(entireProcessTree: true);
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (TimeoutException) { if (Group(process.Id) == process.Id) { if (Kill(-process.Id, 9) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Cannot kill the failed controller launch"); } else if (!process.HasExited) process.Kill(entireProcessTree: true); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
    }
    public static JsonElement StopRequest() => Object(writer => { writer.WriteString("operationId", Identifier(null)); writer.WriteString("action", "stop"); writer.WriteStartObject("target"); writer.WriteString("kind", "daemon"); writer.WriteEndObject(); writer.WriteNumber("expectedRevision", 0); });
    public static async ValueTask<JsonElement> Restart(string root, TimeProvider clock, CancellationToken cancellation)
    {
        using var client = new Client(Path.Combine(root, "fleetd.sock")); var previous = Value(await Call(client, "status", cancellation)); Value(await Call(client, "operate", cancellation, StopRequest())); using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(65), clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token);
        for (;;) { var current = await Call(client, "status", scope.Token); if (!current.IsSuccess) { if (current.Error.Code != "unavailable") throw new CommandFailure(current.Error.Message); break; } await Task.Delay(TimeSpan.FromMilliseconds(100), clock, scope.Token); }
        return await Launch(root, Text(previous.GetProperty("controller"), "name"), clock, cancellation);
    }
}
