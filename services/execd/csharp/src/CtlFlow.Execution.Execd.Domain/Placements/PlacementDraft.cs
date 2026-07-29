using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public sealed record PlacementDraft(
    PlacementId Id,
    PlacementTarget Target,
    PlacementId? ParentId,
    PlacementConstraints Constraints,
    DesiredState DesiredState,
    Revision? ExpectedRevision);
