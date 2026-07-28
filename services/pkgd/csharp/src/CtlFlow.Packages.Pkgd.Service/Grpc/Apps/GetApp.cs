using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Authorization.PackageAuthorization;
using static CtlFlow.Packages.Pkgd.Service.Grpc.PkgdGrpcErrors;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Responses.PackageResponses;
using AppDatabase = CtlFlow.Packages.Pkgd.Db.Apps.Apps;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    public override async Task<CtlFlow.Packages.V1.App> GetApp(
        GetAppRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAppLookup(context);
        var result = await AppDatabase.GetApp(
            _packageDatabase,
            await AppId.Parse(
                request.AppId,
                context.CancellationToken),
            context.CancellationToken);
        if (result is not AppLookupResult.Found found)
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.PkgdCapability.ReadApp,
            found.App.Scope,
            found.App.AppId,
            context.CancellationToken);
        return await CreateAppResponse(
            found.App,
            context.CancellationToken);
    }
}
