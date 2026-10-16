using System.Text.RegularExpressions;
using Crossfire.AdapterProcess;

namespace Crossfire.Server;

public static partial class ContainerCommands
{
    [GeneratedRegex(@"\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice\z", RegexOptions.CultureInvariant)]
    private static partial Regex Slice();
    public static string[] Resources(string? parent) => parent is null ? [] : Slice().IsMatch(parent) ? ["--cgroup-parent", parent] : throw new ArgumentException("Cgroup parent must be an existing systemd slice unit");
    private static string Mount(string directory) => "type=bind,\"source=" + directory.Replace("\"", "\"\"", StringComparison.Ordinal) + "\",target=/runtime";
    public static string[] Migration(string directory, string image, string[] resources) => ["run", "--name", ContainerLifecycle.Names(directory).Migration, "--label", "org.crossfire.directory=" + directory, "--mount", Mount(directory), .. resources, "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image];
    public static string[] Server(string directory, string image, string name, int port, int contentPort, string[] resources) => ["run", "--name", name, "--label", "org.crossfire.directory=" + directory, "--publish", "127.0.0.1:" + port + ":8080", "--publish", "127.0.0.1:" + contentPort + ":8082", "--mount", Mount(directory), .. resources, "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", image];
    public static int CaptureTimeout(IReadOnlyList<string> arguments) => arguments.Count != 0 && arguments[0] is "create" or "stop" or "rm" ? 120000 : 30000;
    public static async ValueTask<CommandOutput> Capture(IReadOnlyList<string> arguments, string workspace, CancellationToken cancellation)
    { var result = await NativeProcess.Capture(new("docker", arguments, workspace, new Dictionary<string, string?>()), 65536, CaptureTimeout(arguments), cancellation); if (!result.IsSuccess) throw new IOException("Docker " + arguments.FirstOrDefault() + " failed: " + result.Error.Message); return result.Value; }
    public static async ValueTask<bool> Image(string tag, string workspace, CancellationToken cancellation) => (await Capture(["image", "inspect", tag], workspace, cancellation)).ExitCode == 0;
    public static async Task Run(IReadOnlyList<string> arguments, string workspace, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested(); var opened = NativeProcess.Start(new("docker", arguments, workspace, new Dictionary<string, string?>())); if (!opened.IsSuccess) throw new IOException(opened.Error.Message);
        await using var process = opened.Value;
        var streams = Task.WhenAll(process.Output.BaseStream.CopyToAsync(Console.OpenStandardError()), process.Errors.BaseStream.CopyToAsync(Console.OpenStandardError()));
        try
        {
            var ended = process.Ended.WaitAsync(cancellation); if (await Task.WhenAny(ended, streams) == streams) await streams;
            await ended; await streams; if (process.ExitCode != 0) throw new IOException("Docker command failed with exit " + process.ExitCode);
        }
        catch { await process.StopAsync(); try { await streams; } catch (IOException) { } throw; }
    }
}
