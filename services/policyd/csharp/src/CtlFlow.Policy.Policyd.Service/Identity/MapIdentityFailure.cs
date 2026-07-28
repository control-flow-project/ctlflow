using CtlFlow.Policy.Policyd.Service.Security;
using Grpc.Core;

namespace CtlFlow.Policy.Policyd.Service.Identity;

internal static partial class IdentityFacts
{
    internal static Exception MapIdentityFailure(
        RpcException exception,
        CancellationToken cancellation)
    {
        if (cancellation.IsCancellationRequested
            && exception.StatusCode is StatusCode.Cancelled
                or StatusCode.DeadlineExceeded)
        {
            return new OperationCanceledException(cancellation);
        }
        return exception.StatusCode switch
        {
            StatusCode.NotFound => new TargetNotFoundException(),
            _ => new IdentityUnavailableException(exception)
        };
    }
}
