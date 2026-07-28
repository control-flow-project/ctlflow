using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Grpc.PkgdGrpcErrors;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Responses.PackageResponses;
using PackageDatabase = CtlFlow.Packages.Pkgd.Db.Packages.Packages;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    public override async Task<Package> GetPackage(
        GetPackageRequest request,
        ServerCallContext context)
    {
        _ = await AuthenticatePackageLookup(context);
        var result = await PackageDatabase.GetPackage(
            _packageDatabase,
            await PackageId.Parse(
                request.PackageId,
                context.CancellationToken),
            await Generation.Parse(
                request.Generation,
                context.CancellationToken),
            context.CancellationToken);
        return result switch
        {
            Db.Packages.PackageContentLookupResult.Found found =>
                await CreatePackageResponse(
                    found.Package,
                    found.Options,
                    context.CancellationToken),
            Db.Packages.PackageContentLookupResult.NotFound =>
                throw CreateExpectedRpcException(StatusCode.NotFound),
            _ => throw new InvalidOperationException(
                "Package lookup result is invalid")
        };
    }
}
