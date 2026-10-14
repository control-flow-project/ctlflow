using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Kernel;

namespace Crossfire.AdapterClient;

public static class ListenerRunner
{
    public static async ValueTask<Result<Unit>> Run(ListenerOptions options, ListenerHost host, string binding, CancellationToken stop)
    {
        using var owner = new StateLock(Path.Combine(Path.GetDirectoryName(options.CursorFile)!, "receiver")); using var local = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var session = ""; using var endpoint = host.Bind(binding, options.Release, options.CursorFile, () => session, () => local.Cancel());
        return await ListenerReceiver.Run(options with
        {
            Budget = host.Budget,
            Runtime = async (hooks, cancellation) => { var result = await options.Runtime(hooks, cancellation); if (result.IsSuccess) session = result.Value.SessionId; return result; },
            Ready = (test, queries) => { endpoint.Ready(test, queries); options.Ready?.Invoke(test, queries); }
        }, local.Token);
    }
}
