using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

// Retained facts read from one persistence snapshot. The resolver's Domain
// decision is the only code that interprets them as authority.
public sealed record WorkloadBindingFacts(
    AppId AppId,
    PackageId PackageId,
    DesiredState DesiredState,
    bool OperationAdmitted,
    IReadOnlyList<PlacementBindingFacts> PlacementChain);
