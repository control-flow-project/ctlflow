using System.Diagnostics;
using System.Text.RegularExpressions;
using Crossfire.AdapterProcess;

namespace Crossfire.Server;

public static partial class ContainerCommands
{
    [GeneratedRegex(@"\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice\z", RegexOptions.CultureInvariant)]
    private static partial Regex Slice();
    public static string[] Resources(string? parent) => parent is null ? [] : Slice().IsMatch(parent) ? ["--cgroup-parent", parent] : throw new ArgumentException("Cgroup parent must be an existing systemd slice unit");
    private static string Mount(string directory) => "type=bind,\"source=" + directory.Replace("\"", "\"\"", StringComparison.Ordinal) + "\",target=/runtime";
    public static string[] Migration(string directory, string image, string[] resources) => ["run", "--rm", "--name", "crossfire-migration-" + Crossfire.Kernel.Identity.Hash(directory)[..16], "--mount", Mount(directory), .. resources, "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image];
    public static string[] Server(string directory, string image, string name, int port, int contentPort, string[] resources) => ["run", "--rm", "--name", name, "--label", "org.crossfire.directory=" + directory, "--publish", "127.0.0.1:" + port + ":8080", "--publish", "127.0.0.1:" + contentPort + ":8082", "--mount", Mount(directory), .. resources, "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image];
    public static async ValueTask<CommandOutput> Capture(IReadOnlyList<string> arguments, string workspace, CancellationToken cancellation)
    { var result = await NativeProcess.Capture(new("docker", arguments, workspace, new Dictionary<string, string?>()), 65536, 30000, cancellation); if (!result.IsSuccess) throw new IOException(result.Error.Message); return result.Value; }
    public static async ValueTask<bool> Image(string tag, string workspace, CancellationToken cancellation) => (await Capture(["image", "inspect", tag], workspace, cancellation)).ExitCode == 0;
    public static async Task Run(IReadOnlyList<string> arguments, string workspace, CancellationToken cancellation)
    {
        var start = new ProcessStartInfo("docker") { UseShellExecute = false, WorkingDirectory = workspace }; foreach (var item in arguments) start.ArgumentList.Add(item); using var process = Process.Start(start) ?? throw new IOException("Cannot start Docker");
        try { await process.WaitForExitAsync(cancellation); if (process.ExitCode != 0) throw new IOException("Docker command failed with exit " + process.ExitCode); }
        catch (OperationCanceledException) { if (!process.HasExited) process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); throw; }
    }
    public static async Task Owned(IReadOnlyList<string> arguments, string name, string workspace, CancellationToken cancellation)
    {
        if (arguments.Count < 2 || arguments[0] != "run" || !arguments.Contains(name)) throw new ArgumentException("Use the owned runtime container command"); cancellation.ThrowIfCancellationRequested();
        var created = await Capture(["create", .. arguments.Skip(1)], workspace, CancellationToken.None); if (created.ExitCode != 0) throw new IOException("Cannot create the owned runtime container: " + created.Errors);
        var identity = created.Output.Trim(); if (identity.Length != 64 || identity.Any(character => !char.IsAsciiHexDigitLower(character))) throw new IOException("Docker did not return an exact container identity");
        using var attach = new CancellationTokenSource(); Task? running = null; Exception? failure = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); running = Run(["start", "--attach", identity], workspace, attach.Token); var cancelled = Task.Delay(Timeout.InfiniteTimeSpan, cancellation);
            if (await Task.WhenAny(running, cancelled) == cancelled)
            {
                using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try { await Run(["stop", "--time", "15", identity], workspace, stop.Token); }
                finally { await attach.CancelAsync(); }
            }
            await running;
        }
        catch (Exception error) { failure = error; }
        finally
        {
            await attach.CancelAsync(); if (running is not null) try { await running; } catch (Exception error) { failure ??= error; }
            var removed = await Capture(["rm", "--force", identity], workspace, CancellationToken.None);
            if (removed.ExitCode != 0)
            {
                var remaining = await Capture(["container", "ls", "--all", "--no-trunc", "--filter", "id=" + identity, "--format", "{{.ID}}"], workspace, CancellationToken.None);
                if (remaining.ExitCode != 0 || remaining.Output.Trim().Length != 0) failure = new IOException("Owned runtime container cleanup is not confirmed", failure);
            }
        }
        if (failure is not null && !(cancellation.IsCancellationRequested && failure is OperationCanceledException)) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }
}
