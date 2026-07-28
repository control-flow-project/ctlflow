using System.Diagnostics;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Auditing.AuditDelivery;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Requests.PackageRequests;
using PackageDatabase = CtlFlow.Packages.Pkgd.Db.Packages.Packages;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    public override async Task<Package> DeclarePackage(
        DeclarePackageRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateDeclaration(context);
        var declaration = await CreatePackageDraft(
            request,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await PackageDatabase.DeclarePackage(
            _packageDatabase,
            declaration.Draft,
            declaration.Options,
            audit,
            context.CancellationToken);
        return await CompletePackageMutation(
            result,
            context.CancellationToken);
    }
}
