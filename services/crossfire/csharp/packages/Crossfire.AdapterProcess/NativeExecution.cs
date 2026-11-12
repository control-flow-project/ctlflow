using Crossfire.Kernel;

namespace Crossfire.AdapterProcess;

// A selected execution boundary owns command placement and reachable endpoints.
// Failure at either boundary is returned unchanged; there is no local retry path.
public sealed record NativeExecution(
    Func<NativeCommand, Result<NativeCommand>> Command,
    Func<string, CancellationToken, ValueTask<Result<string>>> Endpoint,
    SshExecution? Ssh = null)
{
    public static NativeExecution Host { get; } = new(Result<NativeCommand>.Success,
        (endpoint, _) => ValueTask.FromResult(Result<string>.Success(endpoint)));

    public ValueTask<Result<CommandOutput>> Capture(NativeCommand command, int maximumBytes, int timeoutMs, CancellationToken cancellation)
    {
        var selected = Command(command);
        return selected.IsSuccess ? NativeProcess.Capture(selected.Value, maximumBytes, timeoutMs, cancellation)
            : ValueTask.FromResult(Result<CommandOutput>.Fail(selected.Error));
    }
}
