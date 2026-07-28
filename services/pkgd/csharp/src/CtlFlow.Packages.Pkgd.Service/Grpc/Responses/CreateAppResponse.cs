using CtlFlow.Packages.Pkgd.Domain.Apps;
using Google.Protobuf.WellKnownTypes;
using V1 = CtlFlow.Packages.V1;

namespace CtlFlow.Packages.Pkgd.Service.Grpc.Responses;

internal static partial class PackageResponses
{
    internal static ValueTask<V1.App> CreateAppResponse(
        AppDetails app,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new V1.App
        {
            AppId = app.AppId.Value,
            Scope = CreateAppScope(app.Scope),
            PlacementId = app.PlacementId.Value,
            PackageId = app.PackageId.Value,
            DesiredPackageGeneration = checked(
                (ulong)app.DesiredPackageGeneration.Value),
            Revision = checked((ulong)app.Revision.Value),
            CreatedAt = Timestamp.FromDateTimeOffset(app.CreatedAt.Value),
            UpdatedAt = Timestamp.FromDateTimeOffset(app.UpdatedAt.Value)
        });
    }

    private static V1.AppScope CreateAppScope(AppScope scope) =>
        scope switch
        {
            AppScope.Global => new V1.AppScope
            {
                Global = new V1.GlobalAppScope()
            },
            AppScope.Tenant tenant => new V1.AppScope
            {
                Tenant = new V1.TenantAppScope
                {
                    TenantId = tenant.TenantId.Value
                }
            },
            AppScope.Workspace workspace => new V1.AppScope
            {
                Workspace = new V1.WorkspaceAppScope
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                }
            },
            AppScope.User user => new V1.AppScope
            {
                User = new V1.UserAppScope
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId = user.AccountPrincipalId.Value
                }
            },
            _ => throw new InvalidOperationException("App scope is invalid")
        };
}
