using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Packages.V1;

namespace CtlFlow.Execution.Execd.Service.Packages;

internal static partial class PackageAdmission
{
    internal static PackageAppAdmission MapPackageApp(App app)
    {
        try
        {
            if (app.Scope is null)
            {
                throw InvalidApp();
            }

            return new PackageAppAdmission(
                PlacementId.Parse(app.PlacementId),
                MapScope(app.Scope),
                Revision.Parse(app.Revision),
                PackageId.Parse(app.PackageId),
                Revision.Parse(app.DesiredPackageGeneration));
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or InvalidOperationException
                or OverflowException)
        {
            throw InvalidApp();
        }
    }

    private static PlacementTarget MapScope(AppScope scope) =>
        scope.ScopeCase switch
        {
            AppScope.ScopeOneofCase.Global =>
                new PlacementTarget.Global(),
            AppScope.ScopeOneofCase.Tenant =>
                new PlacementTarget.Tenant(
                    TenantId.Parse(scope.Tenant.TenantId)),
            AppScope.ScopeOneofCase.Workspace =>
                new PlacementTarget.Workspace(
                    TenantId.Parse(scope.Workspace.TenantId),
                    WorkspaceId.Parse(scope.Workspace.WorkspaceId)),
            AppScope.ScopeOneofCase.User =>
                new PlacementTarget.User(
                    TenantId.Parse(scope.User.TenantId),
                    PrincipalId.ParseAccount(
                        scope.User.AccountPrincipalId)),
            _ => throw InvalidApp()
        };

    private static ExecutionException InvalidApp() =>
        new(
            ExecutionError.Unavailable,
            "Pkgd returned an invalid App");
}
