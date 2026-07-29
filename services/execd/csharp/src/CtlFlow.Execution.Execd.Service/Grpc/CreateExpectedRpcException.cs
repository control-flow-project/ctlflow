using Grpc.Core;

namespace CtlFlow.Execution.Execd.Service.Grpc;

internal static partial class ExecdGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode status) =>
        new(new Status(status, status.ToString()));
}
