using System.Collections.Concurrent;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Crossfire.Runtime.Tests;

internal sealed class ExecutionRecording
{
    internal ConcurrentQueue<IReadOnlyList<string>> Commands { get; } = new();
    private int endpoints;
    internal int Endpoints => Volatile.Read(ref endpoints);
    internal NativeExecution Port => new(command =>
    {
        Commands.Enqueue(command.Arguments.ToArray());
        return Result<NativeCommand>.Success(command);
    }, (endpoint, _) =>
    {
        Interlocked.Increment(ref endpoints);
        return ValueTask.FromResult(Result<string>.Success(endpoint));
    });
    internal static NativeExecution Rejected { get; } = new(
        _ => Results.Fail<NativeCommand>("forbidden", "Fixture execution rejected"),
        (_, _) => ValueTask.FromResult(Results.Fail<string>("forbidden", "Fixture endpoint rejected")));
}
