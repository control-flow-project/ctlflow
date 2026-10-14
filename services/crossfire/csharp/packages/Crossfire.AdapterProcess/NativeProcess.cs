using System.ComponentModel;
using System.Buffers;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Crossfire.Kernel;

namespace Crossfire.AdapterProcess;

public sealed record NativeCommand(string Binary, IReadOnlyList<string> Arguments, string Workspace, IReadOnlyDictionary<string, string?> Environment, bool Input = false);
public sealed record CommandOutput(int ExitCode, string Output, string Errors);

public sealed partial class NativeProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly bool input;
    private readonly object gate = new();
    private Task? closing;
    private Task? stopping;
    public int Id { get; }
    public StreamReader Output => process.StandardOutput;
    public StreamReader Errors => process.StandardError;
    public StreamWriter Input => input ? process.StandardInput : throw new InvalidOperationException("Native input is not a terminal stream");
    public Task Ended { get; }
    public int ExitCode => process.ExitCode;
    private NativeProcess(Process process, bool input) { this.process = process; this.input = input; Id = process.Id; Ended = process.WaitForExitAsync(); }
    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static partial int Kill(int pid, int signal);
    [LibraryImport("libc", EntryPoint = "getpgid", SetLastError = true)]
    private static partial int Group(int pid);

    public static Result<NativeProcess> Start(NativeCommand command)
    {
        if (!OperatingSystem.IsLinux()) return Results.Fail<NativeProcess>("invalid", "Owned native process groups require Linux");
        if (string.IsNullOrEmpty(command.Binary) || command.Binary.Contains('\0') || !Path.IsPathFullyQualified(command.Workspace)
            || command.Arguments.Any(value => value.Contains('\0')) || command.Arguments.Sum(value => (long)Encoding.UTF8.GetByteCount(value)) > 1048576)
            return Results.Fail<NativeProcess>("invalid", "Invalid native executable, workspace or arguments");
        var start = new ProcessStartInfo("/usr/bin/setsid") { UseShellExecute = false, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = command.Workspace,
            StandardOutputEncoding = new UTF8Encoding(false, true), StandardErrorEncoding = new UTF8Encoding(false, true) };
        start.ArgumentList.Add("--"); start.ArgumentList.Add(command.Binary);
        foreach (var argument in command.Arguments) start.ArgumentList.Add(argument);
        foreach (var value in command.Environment)
        { if (value.Value is null) start.Environment.Remove(value.Key); else start.Environment[value.Key] = value.Value; }
        try
        {
            var process = Process.Start(start) ?? throw new IOException("Native process was not created");
            if (!command.Input) process.StandardInput.Close();
            return Result<NativeProcess>.Success(new(process, command.Input));
        }
        catch (Exception error) when (error is Win32Exception or IOException or UnauthorizedAccessException or ArgumentException)
        { return Results.Fail<NativeProcess>("native", "Cannot start the native executable in its owned Linux process group; verify the executable and /usr/bin/setsid"); }
    }

    public static async ValueTask<Result<CommandOutput>> Capture(NativeCommand command, int maximumBytes, int timeoutMs, CancellationToken cancellation)
    {
        if (maximumBytes is < 1 or > 2097152 || timeoutMs is < 100 or > 300000 || command.Input)
            return Results.Fail<CommandOutput>("invalid", "Native command collection requires bounded output, deadline and no interactive input");
        cancellation.ThrowIfCancellationRequested();
        var opened = Start(command); if (!opened.IsSuccess) return Result<CommandOutput>.Fail(opened.Error);
        await using var owned = opened.Value; using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation); stop.CancelAfter(timeoutMs);
        var output = Read(owned.Output.BaseStream, maximumBytes, stop.Token); var errors = Read(owned.Errors.BaseStream, maximumBytes, stop.Token);
        try
        {
            var streams = Task.WhenAll(output, errors); var ended = owned.Ended.WaitAsync(stop.Token);
            var first = await Task.WhenAny(streams, ended);
            if (first == streams) await streams;
            await ended; var values = await streams;
            return Result<CommandOutput>.Success(new(owned.ExitCode, values[0], values[1]));
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or DecoderFallbackException)
        {
            await stop.CancelAsync(); await owned.StopAsync();
            try { await Task.WhenAll(output, errors); } catch (Exception stopped) when (stopped is IOException or OperationCanceledException or DecoderFallbackException) { }
            return Results.Fail<CommandOutput>("native", "Native prerequisite command exceeded its output/deadline bound or was cancelled");
        }
    }
    private static async Task<string> Read(Stream stream, int maximumBytes, CancellationToken cancellation)
    {
        var output = new ArrayBufferWriter<byte>();
        for (;;)
        {
            var required = Math.Min(8192, maximumBytes - output.WrittenCount + 1);
            var count = await stream.ReadAsync(output.GetMemory(required)[..required], cancellation);
            if (count == 0) return new UTF8Encoding(false, true).GetString(output.WrittenSpan);
            output.Advance(count); if (output.WrittenCount > maximumBytes) throw new IOException("Native prerequisite output exceeded its finite byte bound");
        }
    }
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? completion = null; Task selected;
        lock (gate) { if (closing is null) { completion = new(TaskCreationOptions.RunContinuationsAsynchronously); closing = completion.Task; } selected = closing; }
        if (completion is not null) _ = Finish(completion);
        return new(selected);
    }
    private async Task Finish(TaskCompletionSource completion)
    {
        try { await Close(); completion.TrySetResult(); }
        catch (Exception error) { completion.TrySetException(error); }
    }
    public Task StopAsync() { lock (gate) return stopping ??= Terminate(); }
    private async Task Close()
    {
        try { await StopAsync(); }
        finally { process.Dispose(); }
    }
    private async Task Terminate()
    {
            var group = Group(Id);
            if (group == Id || Ended.IsCompleted)
            {
                if (Kill(-Id, 15) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Native group termination failed");
            }
            else if (group >= 0 && !process.HasExited) process.Kill(entireProcessTree: true);
            else if (group < 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Native process ownership inspection failed");
            try
            {
                await Ended.WaitAsync(TimeSpan.FromSeconds(3));
                if (Kill(-Id, 9) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Remaining native group members could not be stopped");
            }
            catch (TimeoutException)
            {
                if (Group(Id) == Id) { if (Kill(-Id, 9) != 0 && Marshal.GetLastPInvokeError() != 3) throw new IOException("Native group kill failed"); }
                else if (!process.HasExited) process.Kill(entireProcessTree: true);
                await Ended.WaitAsync(TimeSpan.FromSeconds(5));
            }
    }
}
