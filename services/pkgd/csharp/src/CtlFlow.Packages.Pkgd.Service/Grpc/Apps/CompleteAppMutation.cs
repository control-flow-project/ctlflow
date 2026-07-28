using CtlFlow.Packages.Pkgd.Domain.Apps;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Auditing.AuditDelivery;
using static CtlFlow.Packages.Pkgd.Service.Grpc.PkgdGrpcErrors;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Responses.PackageResponses;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    private async Task<CtlFlow.Packages.V1.App> CompleteAppMutation(
        AppMutationResult result,
        CancellationToken cancellation)
    {
        switch (result)
        {
            case AppMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return await CreateAppResponse(
                    changed.App,
                    cancellation);
            case AppMutationResult.Current current:
                return await CreateAppResponse(
                    current.App,
                    cancellation);
            case AppMutationResult.NotFound:
                throw CreateExpectedRpcException(StatusCode.NotFound);
            case AppMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case AppMutationResult.RevisionMismatch:
                throw CreateExpectedRpcException(StatusCode.Aborted);
            case AppMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            default:
                throw new InvalidOperationException(
                    "App mutation result is invalid");
        }
    }
}
