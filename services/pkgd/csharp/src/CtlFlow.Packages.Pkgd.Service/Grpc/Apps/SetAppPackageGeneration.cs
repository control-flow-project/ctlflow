using System.Diagnostics;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Auditing.AuditDelivery;
using static CtlFlow.Packages.Pkgd.Service.Authorization.PackageAuthorization;
using static CtlFlow.Packages.Pkgd.Service.Grpc.PkgdGrpcErrors;
using AppDatabase = CtlFlow.Packages.Pkgd.Db.Apps.Apps;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    public override async Task<CtlFlow.Packages.V1.App>
        SetAppPackageGeneration(
        SetAppPackageGenerationRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAppMutation(context);
        var appId = await AppId.Parse(
            request.AppId,
            context.CancellationToken);
        var expectedRevision = await Revision.Parse(
            request.ExpectedRevision,
            context.CancellationToken);
        var desiredGeneration = await Generation.Parse(
            request.DesiredPackageGeneration,
            context.CancellationToken);
        var current = await AppDatabase.GetApp(
            _packageDatabase,
            appId,
            context.CancellationToken);
        if (current is not AppLookupResult.Found found)
        {
            throw CreateExpectedRpcException(StatusCode.NotFound);
        }

        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.PkgdCapability.SetAppPackageGeneration,
            found.App.Scope,
            found.App.AppId,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await AppDatabase.SetAppPackageGeneration(
            _packageDatabase,
            appId,
            expectedRevision,
            desiredGeneration,
            audit,
            context.CancellationToken);
        return await CompleteAppMutation(
            result,
            context.CancellationToken);
    }
}
