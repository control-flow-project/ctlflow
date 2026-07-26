using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal static partial class TenantGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode statusCode) =>
        new(new Status(statusCode, statusCode.ToString()));
}
