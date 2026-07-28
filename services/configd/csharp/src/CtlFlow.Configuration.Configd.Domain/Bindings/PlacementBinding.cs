using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Bindings;

public sealed record PlacementBinding(
    PlacementId PlacementId,
    PlacementScope Scope);
