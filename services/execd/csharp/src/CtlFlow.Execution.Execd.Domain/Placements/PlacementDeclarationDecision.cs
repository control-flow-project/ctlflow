using CtlFlow.Execution.Execd.Domain.Auditing;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public abstract record PlacementDeclarationDecision
{
    private PlacementDeclarationDecision()
    {
    }

    public sealed record Current(PlacementRecord Placement)
        : PlacementDeclarationDecision;

    public sealed record Changed(
        Placement Entity,
        PlacementRecord Placement,
        AuditIntent Audit,
        bool IsCreate) : PlacementDeclarationDecision;
}
