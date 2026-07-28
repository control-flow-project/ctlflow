using System.Diagnostics;
using CtlFlow.Packages.V1;
using Grpc.Core;
using static CtlFlow.Packages.Pkgd.Service.Auditing.AuditDelivery;
using static CtlFlow.Packages.Pkgd.Service.Authorization.PackageAuthorization;
using static CtlFlow.Packages.Pkgd.Service.Grpc.Requests.PackageRequests;
using AppDatabase = CtlFlow.Packages.Pkgd.Db.Apps.Apps;

namespace CtlFlow.Packages.Pkgd.Service.Grpc;

internal sealed partial class PackageGrpcService
{
    public override async Task<App> CreateApp(
        CreateAppRequest request,
        ServerCallContext context)
    {
        var identity = await AuthenticateAppCreation(context);
        var draft = await CreateAppDraft(
            request,
            context.CancellationToken);
        await AuthorizeCapability(
            _policyClient,
            _settings.Policy,
            _telemetry,
            identity,
            Authorization.PkgdCapability.CreateApp,
            draft.Scope,
            null,
            context.CancellationToken);
        var audit = await CreateAuditContext(
            identity,
            Activity.Current,
            DateTimeOffset.UtcNow,
            context.CancellationToken);
        var result = await AppDatabase.CreateApp(
            _packageDatabase,
            draft,
            audit,
            context.CancellationToken);
        return await CompleteAppMutation(
            result,
            context.CancellationToken);
    }
}
