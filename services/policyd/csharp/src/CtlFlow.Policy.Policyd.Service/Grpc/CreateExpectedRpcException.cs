using Grpc.Core;
using static CtlFlow.Policy.Policyd.Service.Grpc.GrpcStatuses;

namespace CtlFlow.Policy.Policyd.Service.Grpc;

internal static partial class PolicyGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode statusCode) =>
        new(new Status(statusCode, GetCanonicalStatusName(statusCode)));
}
