using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Targets;

// The effective containment of an admitted product Workload, as Domain data.
// Service maps the dependency's wire target onto this closed union; the rule
// below is the only place containment is decided.
public abstract record PlacementContainment
{
    private PlacementContainment()
    {
    }

    public sealed record Global : PlacementContainment;

    public sealed record Tenant(TenantId TenantId) : PlacementContainment;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : PlacementContainment;

    public sealed record User(
        TenantId TenantId,
        PrincipalId AccountPrincipalId) : PlacementContainment;
}
