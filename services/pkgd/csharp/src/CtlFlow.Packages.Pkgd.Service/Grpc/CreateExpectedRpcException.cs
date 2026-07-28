using Grpc.Core;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal static partial class PkgdGrpcErrors
{
    internal static RpcException CreateExpectedRpcException(
        StatusCode status) =>
        new(new Status(status, status.ToString()));
}
