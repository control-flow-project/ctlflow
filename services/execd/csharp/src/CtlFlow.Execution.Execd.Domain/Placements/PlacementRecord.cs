using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public sealed record PlacementRecord(
    PlacementId Id,
    PlacementTarget Target,
    PlacementId? ParentId,
    PlacementConstraints Constraints,
    DesiredState DesiredState,
    Revision Revision,
    RealizationStatus Realization,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
