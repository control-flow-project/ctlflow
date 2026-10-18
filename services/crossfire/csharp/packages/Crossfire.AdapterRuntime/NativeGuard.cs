using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Crossfire.AdapterRuntime;

public static partial class NativeGuard
{
    private const string Mode = "--crossfire-native-guard";
    [LibraryImport("libc", EntryPoint = "getppid")]
    private static partial int Parent();
    [LibraryImport("libc", EntryPoint = "getpgrp")]
    private static partial int Group();
    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Kill(int pid, int signal);
    public static bool Requested(string[] arguments) => arguments.FirstOrDefault() == Mode;

    public static Result<NativeProcess> Start(NativeCommand command, string directory, string identity)
    {
        var executable = Environment.ProcessPath;
        if (executable is null) return Results.Fail<NativeProcess>("native", "The native process guard requires its installed executable");
        return NativeProcess.Start(new(executable, [Mode, Environment.ProcessId.ToString(CultureInfo.InvariantCulture), directory, identity,
            "--", command.Binary, ..command.Arguments], command.Workspace, command.Environment, command.Input), 8000);
    }

    public static async Task<int> Run(string[] arguments)
    {
        if (arguments.Length < 6 || !Requested(arguments) || !int.TryParse(arguments[1], NumberStyles.None, CultureInfo.InvariantCulture, out var parentId)
            || parentId < 1 || Parent() != parentId || Group() != Environment.ProcessId || !Path.IsPathFullyQualified(arguments[2]) || arguments[3].Length is < 1 or > 64
            || arguments[3].Any(value => !char.IsAsciiLetterOrDigit(value) && value is not ('-' or '_')) || arguments[4] != "--")
            throw new ArgumentException("Invalid owned native process guard");
        PrivateFiles.ExistingDirectory(arguments[2], true);
        using var parent = Process.GetProcessById(parentId);
        if (Parent() != parentId) return 1;
        using var stop = new CancellationTokenSource();
        using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; stop.Cancel(); });
        using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; stop.Cancel(); });
        using var hangup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, context => { context.Cancel = true; stop.Cancel(); });
        var parentEnded = parent.WaitForExitAsync(stop.Token);
        var deadline = Stopwatch.StartNew();
        StateLock? ownership = null;
        while (ownership is null)
        {
            if (Parent() != parentId || parentEnded.IsCompleted || stop.IsCancellationRequested) return 1;
            try { ownership = new(Path.Combine(arguments[2], "crossfire-native-process-" + arguments[3])); }
            catch (IOException error) when (error.Message == "Another process already owns this private state" && deadline.ElapsedMilliseconds < 10000)
            { await Task.Delay(25, stop.Token); }
        }
        using (ownership)
        {
            if (Parent() != parentId || parentEnded.IsCompleted || stop.IsCancellationRequested) return 1;
            var opened = NativeProcess.Start(new(arguments[5], arguments[6..], Environment.CurrentDirectory, new Dictionary<string, string?>(), Input: true), isolate: false);
            if (!opened.IsSuccess) throw new IOException(opened.Error.Message);
            await using var child = opened.Value;
            var output = child.Output.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var errors = child.Errors.BaseStream.CopyToAsync(Console.OpenStandardError());
            var input = CopyInput(Console.OpenStandardInput(), child.Input.BaseStream);
            try
            {
                await Task.WhenAny(parentEnded, child.Ended, Task.Delay(Timeout.Infinite, stop.Token));
                if (Kill(-Environment.ProcessId, 9) != 0) throw new IOException("Cannot stop the exact owned native process group");
                throw new IOException("Owned native process group did not terminate");
            }
            finally { await stop.CancelAsync(); _ = input; }
        }
    }
    private static async Task CopyInput(Stream input, Stream output)
    {
        try { await input.CopyToAsync(output); await output.FlushAsync(); output.Close(); }
        catch (Exception error) when (error is IOException or ObjectDisposedException) { }
    }
}
