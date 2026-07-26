using Grpc.Core;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

using static GrpcStatuses;

internal static partial class IdentityGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode statusCode) =>
        new(new Status(
            statusCode,
            GetCanonicalStatusName(statusCode)));
}
