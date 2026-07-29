using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static ValueTask<PageSize> ParsePageSize(
        uint value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(PageSize.Parse(value));
    }
}
