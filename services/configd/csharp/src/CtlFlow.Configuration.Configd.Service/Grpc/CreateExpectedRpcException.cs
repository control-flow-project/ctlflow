using Grpc.Core;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal static partial class ConfigdGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode status) =>
        new(new Status(status, status.ToString()));
}
