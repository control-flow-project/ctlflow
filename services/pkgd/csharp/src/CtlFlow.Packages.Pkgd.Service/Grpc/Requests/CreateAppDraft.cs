using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using V1 = CtlFlow.Packages.V1;

namespace CtlFlow.Packages.Pkgd.Service.Grpc.Requests;

internal static partial class PackageRequests
{
    internal static async ValueTask<AppDraft> CreateAppDraft(
        V1.CreateAppRequest request,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (request.Scope is null)
        {
            throw new ArgumentException("App scope is required");
        }

        return new AppDraft(
            await AppId.Parse(request.AppId, cancellation),
            await ParseAppScope(request.Scope, cancellation),
            await PlacementId.Parse(request.PlacementId, cancellation),
            await PackageId.Parse(request.PackageId, cancellation),
            await Generation.Parse(
                request.DesiredPackageGeneration,
                cancellation));
    }

    private static async ValueTask<AppScope> ParseAppScope(
        V1.AppScope value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return value.ScopeCase switch
        {
            V1.AppScope.ScopeOneofCase.Global =>
                new AppScope.Global(),
            V1.AppScope.ScopeOneofCase.Tenant =>
                new AppScope.Tenant(
                    await TenantId.Parse(
                        value.Tenant.TenantId,
                        cancellation)),
            V1.AppScope.ScopeOneofCase.Workspace =>
                new AppScope.Workspace(
                    await TenantId.Parse(
                        value.Workspace.TenantId,
                        cancellation),
                    await WorkspaceId.Parse(
                        value.Workspace.WorkspaceId,
                        cancellation)),
            V1.AppScope.ScopeOneofCase.User =>
                new AppScope.User(
                    await TenantId.Parse(
                        value.User.TenantId,
                        cancellation),
                    await AccountPrincipalId.Parse(
                        value.User.AccountPrincipalId,
                        cancellation)),
            _ => throw new ArgumentException("App scope is invalid")
        };
    }
}
