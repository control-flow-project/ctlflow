using CtlFlow.Configuration.Configd.Domain.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Bindings;

public sealed record ConsumerBinding(
    PlacementBinding Placement,
    ConsumerId ConsumerId,
    Purpose Purpose);
