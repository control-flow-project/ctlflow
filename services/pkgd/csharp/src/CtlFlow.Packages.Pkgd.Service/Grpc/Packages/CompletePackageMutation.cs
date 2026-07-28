using CtlFlow.Packages.Pkgd.Db.Packages;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Auditing.AuditDelivery;
using static CtlFlow.Packages.Pkgd.Service.Grpc.PkgdGrpcErrors;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Responses.PackageResponses;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    private async Task<Package> CompletePackageMutation(
        PackageDeclarationResult result,
        CancellationToken cancellation)
    {
        switch (result.Mutation)
        {
            case PackageMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return await CreatePackageResponse(
                    changed.Details,
                    result.Options,
                    cancellation);
            case PackageMutationResult.Current current:
                return await CreatePackageResponse(
                    current.Package,
                    result.Options,
                    cancellation);
            case PackageMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case PackageMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            default:
                throw new InvalidOperationException(
                    "Package mutation result is invalid");
        }
    }
}
