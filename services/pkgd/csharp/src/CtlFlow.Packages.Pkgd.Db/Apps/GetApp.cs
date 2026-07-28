using CtlFlow.Packages.Pkgd.Db.Providers;
using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Apps;

public static partial class Apps
{
    public static async Task<AppLookupResult> GetApp(
        PackageDatabase packageDatabase,
        AppId appId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = PackageDbTelemetry.StartOperation("get_app");
        var app = await QueryApp(packageDatabase, appId, cancellation);
        return app is null
            ? new AppLookupResult.NotFound()
            : new AppLookupResult.Found(app);
    }

    private static async Task<AppDetails?> QueryApp(
        PackageDatabase packageDatabase,
        AppId appId,
        CancellationToken cancellation)
    {
        await using var database =
            await packageDatabase.Contexts.CreateDbContextAsync(cancellation);
        var appIdValue = appId.Value;
        var queryCancellation = cancellation;
        var row = await database.Apps
            .AsNoTracking()
            .Where(value =>
                EF.Property<string>(value, "_appId") == appIdValue)
            .Select(value => new
            {
                AppId = EF.Property<string>(value, "_appId"),
                ScopeKind = EF.Property<int>(value, "_scopeKind"),
                TenantId = EF.Property<string?>(value, "_tenantId"),
                WorkspaceId = EF.Property<string?>(value, "_workspaceId"),
                AccountPrincipalId =
                    EF.Property<string?>(value, "_accountPrincipalId"),
                PlacementId = EF.Property<string>(value, "_placementId"),
                PackageId = EF.Property<string>(value, "_packageId"),
                InitialGeneration =
                    EF.Property<long>(
                        value,
                        "_initialPackageGeneration"),
                DesiredGeneration =
                    EF.Property<long>(
                        value,
                        "_desiredPackageGeneration"),
                Revision = EF.Property<long>(value, "_revision"),
                value.CreatedAt,
                value.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);
        return row is null
            ? null
            : new AppDetails(
                AppId.FromStorage(row.AppId),
                CreateScope(
                    row.ScopeKind,
                    row.TenantId,
                    row.WorkspaceId,
                    row.AccountPrincipalId),
                PlacementId.FromStorage(row.PlacementId),
                PackageId.FromStorage(row.PackageId),
                Generation.FromStorage(row.InitialGeneration),
                Generation.FromStorage(row.DesiredGeneration),
                Revision.FromStorage(row.Revision),
                row.CreatedAt,
                row.UpdatedAt);
    }

    private static AppScope CreateScope(
        int kind,
        string? tenantId,
        string? workspaceId,
        string? accountPrincipalId) =>
        kind switch
        {
            (int)AppScopeKind.Global when
                tenantId is null
                && workspaceId is null
                && accountPrincipalId is null =>
                new AppScope.Global(),
            (int)AppScopeKind.Tenant when
                tenantId is not null
                && workspaceId is null
                && accountPrincipalId is null =>
                new AppScope.Tenant(TenantId.FromStorage(tenantId)),
            (int)AppScopeKind.Workspace when
                tenantId is not null
                && workspaceId is not null
                && accountPrincipalId is null =>
                new AppScope.Workspace(
                    TenantId.FromStorage(tenantId),
                    WorkspaceId.FromStorage(workspaceId)),
            (int)AppScopeKind.User when
                tenantId is not null
                && workspaceId is null
                && accountPrincipalId is not null =>
                new AppScope.User(
                    TenantId.FromStorage(tenantId),
                    AccountPrincipalId.FromStorage(accountPrincipalId)),
            _ => throw new InvalidOperationException(
                "Stored App scope is invalid")
        };

    private static async Task<bool> PackageGenerationExists(
        PackageDatabase packageDatabase,
        PackageId packageId,
        Generation generation,
        CancellationToken cancellation)
    {
        await using var database =
            await packageDatabase.Contexts.CreateDbContextAsync(cancellation);
        var packageIdValue = packageId.Value;
        var generationValue = generation.Value;
        var queryCancellation = cancellation;
        return await database.PackageGenerations
            .AsNoTracking()
            .AnyAsync(
                value =>
                    EF.Property<string>(value, "_packageId") == packageIdValue
                    && EF.Property<long>(value, "_generation")
                        == generationValue,
                queryCancellation);
    }
}
