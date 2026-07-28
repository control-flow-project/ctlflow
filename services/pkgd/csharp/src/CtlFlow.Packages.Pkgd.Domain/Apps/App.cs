using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public class App
{
    private string? _accountPrincipalId;
    private string _appId = null!;
    private long _desiredPackageGeneration;
    private long _initialPackageGeneration;
    private string _packageId = null!;
    private string _placementId = null!;
    private long _revision;
    private int _scopeKind;
    private string? _tenantId;
    private string? _workspaceId;

    private App()
    {
    }

    internal App(
        AppId appId,
        AppScope scope,
        PlacementId placementId,
        PackageId packageId,
        Generation initialPackageGeneration,
        Generation desiredPackageGeneration,
        Revision revision,
        UtcInstant createdAt,
        UtcInstant updatedAt)
    {
        _appId = appId.Value;
        SetScope(scope);
        _placementId = placementId.Value;
        _packageId = packageId.Value;
        _initialPackageGeneration = initialPackageGeneration.Value;
        _desiredPackageGeneration = desiredPackageGeneration.Value;
        _revision = revision.Value;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public AppId AppId => AppId.FromStorage(_appId);

    public AppScope Scope => _scopeKind switch
    {
        (int)AppScopeKind.Global when
            _tenantId is null
            && _workspaceId is null
            && _accountPrincipalId is null =>
            new AppScope.Global(),
        (int)AppScopeKind.Tenant when
            _tenantId is not null
            && _workspaceId is null
            && _accountPrincipalId is null =>
            new AppScope.Tenant(TenantId.FromStorage(_tenantId)),
        (int)AppScopeKind.Workspace when
            _tenantId is not null
            && _workspaceId is not null
            && _accountPrincipalId is null =>
            new AppScope.Workspace(
                TenantId.FromStorage(_tenantId),
                WorkspaceId.FromStorage(_workspaceId)),
        (int)AppScopeKind.User when
            _tenantId is not null
            && _workspaceId is null
            && _accountPrincipalId is not null =>
            new AppScope.User(
                TenantId.FromStorage(_tenantId),
                AccountPrincipalId.FromStorage(_accountPrincipalId)),
        _ => throw new InvalidOperationException(
            "Stored App scope is invalid")
    };

    public PlacementId PlacementId => PlacementId.FromStorage(_placementId);

    public PackageId PackageId => PackageId.FromStorage(_packageId);

    public Generation InitialPackageGeneration =>
        Generation.FromStorage(_initialPackageGeneration);

    public Generation DesiredPackageGeneration =>
        Generation.FromStorage(_desiredPackageGeneration);

    public Revision Revision => Revision.FromStorage(_revision);

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;

    internal void SetDesiredPackageGeneration(
        Generation generation,
        UtcInstant updatedAt)
    {
        _desiredPackageGeneration = generation.Value;
        _revision = Revision.Next().Value;
        UpdatedAt = updatedAt;
    }

    private void SetScope(AppScope scope)
    {
        switch (scope)
        {
            case AppScope.Global:
                _scopeKind = (int)AppScopeKind.Global;
                break;
            case AppScope.Tenant tenant:
                _scopeKind = (int)AppScopeKind.Tenant;
                _tenantId = tenant.TenantId.Value;
                break;
            case AppScope.Workspace workspace:
                _scopeKind = (int)AppScopeKind.Workspace;
                _tenantId = workspace.TenantId.Value;
                _workspaceId = workspace.WorkspaceId.Value;
                break;
            case AppScope.User user:
                _scopeKind = (int)AppScopeKind.User;
                _tenantId = user.TenantId.Value;
                _accountPrincipalId = user.AccountPrincipalId.Value;
                break;
            default:
                throw new InvalidOperationException("App scope is invalid");
        }
    }
}
