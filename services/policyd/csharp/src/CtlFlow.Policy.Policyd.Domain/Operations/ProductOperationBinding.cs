using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Domain.Operations;

public sealed record ProductOperationBinding(
    PlacementContainment Containment,
    AppId AppId,
    PackageId PackageId);
