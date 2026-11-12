using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using System.Text.Json;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class NativeOwnershipAcceptance
{
    private const string ProbeMode = "--native-ownership-probe";
    public static bool Requested(string[] args) => args.FirstOrDefault() == ProbeMode;
    public static async Task Probe(string[] args)
    {
        if (args.Length != 4 || !Requested(args)) throw new ArgumentException("Invalid ownership probe");
        StateLock ownership;
        try { ownership = NativeOwnership.Acquire(args[1], args[2], args[3]); }
        catch (IOException) { Console.WriteLine("rejected"); return; }
        using (ownership) { Console.WriteLine("owned"); await Console.In.ReadLineAsync(); }
    }

    public static async Task Verify()
    {
        var root = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "native-ownership-" + Identity.Identifier()));
        try
        {
            var workspace = PrivateFiles.Directory(Path.Combine(root, "workspace"));
            var home = PrivateFiles.Directory(Path.Combine(root, "native"));
            var directory = Path.Combine(root, "host-control");
            void Reject(string selected, string label)
            {
                var rejected = false;
                try { using var lease = NativeOwnership.Acquire(selected, workspace, home); }
                catch (IOException) { rejected = true; }
                Equal(rejected, true, label);
            }
            Reject(workspace, "ownership cannot be exported as the workspace");
            Reject(Path.Combine(workspace, "control"), "ownership cannot be a workspace child");
            Reject(home, "ownership cannot be exported as native storage");
            Reject(Path.Combine(home, "control"), "ownership cannot be a native-home child");
            Reject("relative-control", "ownership requires an exact host path");
            Reject(root + "/other/../control", "ownership rejects unresolved parent segments");
            Reject(directory + "/", "ownership rejects trailing separators");
            Reject(directory + "\\alias", "ownership rejects alternate separators");
            var rootRejected = false;
            try { using var lease = NativeOwnership.Acquire(directory, "/", home); }
            catch (IOException) { rootRejected = true; }
            Equal(rootRejected, true, "root workspace cannot hide host-only ownership");
            Equal(Directory.Exists(Path.Combine(workspace, "control")), false, "unsafe ownership is rejected before creating files");
            var command = new NativeCommand(Environment.ProcessPath!, [ProbeMode, directory, workspace, home], root, new Dictionary<string, string?>(), Input: true);
            using (var lease = NativeOwnership.Acquire(directory, workspace, home))
            {
                Reject(directory, "one process cannot acquire two native owners");
                var opened = NativeProcess.Start(command); Equal(opened.IsSuccess, true, "separate ownership probe starts");
                await using var child = opened.Value;
                Equal(await child.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)), "rejected", "a separate host process cannot acquire the active ownership lease");
                await child.Ended.WaitAsync(TimeSpan.FromSeconds(10)); Equal(child.ExitCode, 0, "ownership conflict probe exits normally");
            }
            var next = NativeProcess.Start(command); Equal(next.IsSuccess, true, "ownership successor starts");
            await using (var child = next.Value)
            {
                Equal(await child.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)), "owned", "a separate host process acquires the released lease");
                Reject(directory, "host controller cannot overlap a live successor");
                await child.Input.WriteLineAsync("close"); await child.Input.FlushAsync();
                await child.Ended.WaitAsync(TimeSpan.FromSeconds(10)); Equal(child.ExitCode, 0, "ownership successor closes cleanly");
            }
            using var restored = NativeOwnership.Acquire(directory, workspace, home);
            Equal(File.Exists(Path.Combine(directory, "owner.lock")), true, "the sole lease lives in host control storage");
            Equal(File.Exists(Path.Combine(home, "owner.lock")), false, "native storage carries no ownership lease");
            var link = Path.Combine(root, "linked-control"); Directory.CreateSymbolicLink(link, directory);
            Reject(link, "symlinked ownership cannot substitute another host directory");
            var shared = PrivateFiles.Directory(Path.Combine(root, "shared-control"));
            File.SetUnixFileMode(shared, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead);
            Reject(shared, "existing shared ownership directories are rejected");
            Equal((File.GetUnixFileMode(shared) & UnixFileMode.GroupRead) != 0, true, "rejection does not silently rewrite existing permissions");
            foreach (var runtime in new[] { "codex", "pi" })
            {
                var state = PrivateFiles.Directory(Path.Combine(root, "state-" + runtime));
                var nativeHome = Path.Combine(state, "." + runtime);
                var control = Path.Combine(root, "control-" + runtime);
                var adapter = runtime == "codex" ? Crossfire.AdapterCodex.CodexRuntime.Create("/nonexistent", root)
                    : Crossfire.AdapterPi.PiRuntime.Create("/nonexistent", root);
                using var options = JsonDocument.Parse(runtime == "codex" ? "{\"sandbox_mode\":\"read-only\",\"approval_policy\":\"never\"}" : "{\"provider\":\"fixture\",\"model\":\"fixture\"}");
                using var lease = NativeOwnership.Acquire(control, workspace, nativeHome);
                var input = new OwnedRuntimeInput("ownership-test", "Ownership test", workspace, state, control, "No model work.", options.RootElement,
                    new((_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("forbidden", "No native requests are authorized"))), AllowNewHistory: true);
                Equal((await adapter.Start(input, CancellationToken.None)).IsSuccess, false, runtime + " admission excludes a second owner");
                Equal((await adapter.Inspect(new(workspace, state, control, options.RootElement), CancellationToken.None)).IsSuccess, false, runtime + " inspection cannot overlap an owner");
                Equal(adapter.Reset(new(workspace, state, control, Identity.Identifier())).IsSuccess, false, runtime + " reset cannot overlap an owner");
                Equal(Directory.Exists(nativeHome), false, runtime + " rejected operations do not prepare native files");
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
