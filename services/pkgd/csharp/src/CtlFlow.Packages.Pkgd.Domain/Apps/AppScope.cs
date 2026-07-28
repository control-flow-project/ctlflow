namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public abstract record AppScope
{
    private AppScope()
    {
    }

    public sealed record Global : AppScope;

    public sealed record Tenant(TenantId TenantId) : AppScope;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : AppScope;

    public sealed record User(
        TenantId TenantId,
        AccountPrincipalId AccountPrincipalId) : AppScope;
}
