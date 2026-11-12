using Crossfire.AdapterProcess;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

internal static class NativeExecutionAcceptance
{
    internal static async Task Verify()
    {
        var original = new NativeCommand("/cannot-run-this-on-the-host", ["original argument"], Path.GetTempPath(), new Dictionary<string, string?>());
        Equal(ReferenceEquals(NativeExecution.Host.Command(original).Value, original), true, "Host execution retains the exact invocation");
        var rejected = new NativeExecution(_ => Results.Fail<NativeCommand>("forbidden", "selected placement rejected"),
            (_, _) => ValueTask.FromResult(Results.Fail<string>("forbidden", "selected endpoint rejected")));
        var refused = await rejected.Capture(original, 1024, 5000, CancellationToken.None);
        Equal(!refused.IsSuccess && refused.Error.Code == "forbidden" && refused.Error.Message == "selected placement rejected", true,
            "Rejected placement returns its failure without attempting the host executable");
        var closed = await rejected.Endpoint("ws://127.0.0.1:9876", CancellationToken.None);
        Equal(!closed.IsSuccess && closed.Error.Message == "selected endpoint rejected", true, "Endpoint rejection is not replaced by the host endpoint");
        NativeCommand? received = null;
        var selected = new NativeExecution(command =>
        {
            received = command;
            return Result<NativeCommand>.Success(command with { Binary = "/usr/bin/printf", Arguments = ["%s", command.Arguments[0]] });
        }, (endpoint, _) => ValueTask.FromResult(Result<string>.Success(endpoint)));
        var captured = await selected.Capture(original, 1024, 5000, CancellationToken.None);
        Equal(ReferenceEquals(received, original), true, "Placement sees the complete original typed command");
        Equal(captured.IsSuccess && captured.Value.Output == "original argument", true, "Capture runs the selected executable and arguments");
    }
}
