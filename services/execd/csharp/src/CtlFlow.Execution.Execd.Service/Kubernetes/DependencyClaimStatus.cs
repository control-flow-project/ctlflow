using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed record DependencyClaimStatus(
    long ObservedRevision,
    DependencyBindingPhase Phase,
    BindingId? BindingId,
    Revision? BindingRevision,
    IReadOnlyList<ConfigTargetReference> Outputs);
