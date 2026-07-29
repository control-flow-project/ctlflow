using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<AdmittedDependency?> ApplyDependencyBinding(
        WorkloadRecord current,
        Revision expectedWorkloadRevision,
        ComponentId componentId,
        DependencyName dependencyName,
        Revision claimRevision,
        long observedClaimRevision,
        DependencyBindingPhase phase,
        BindingId? bindingId,
        Revision? bindingRevision,
        IReadOnlyList<ConfigTargetReference> outputs,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Revision != expectedWorkloadRevision)
        {
            return ValueTask.FromResult<AdmittedDependency?>(null);
        }

        var retained = current.Dependencies.SingleOrDefault(
            item =>
                item.Selection.ComponentId == componentId
                && item.Selection.Name == dependencyName);
        if (retained is null || retained.ClaimRevision != claimRevision)
        {
            return ValueTask.FromResult<AdmittedDependency?>(null);
        }

        ValidateBinding(
            claimRevision,
            observedClaimRevision,
            phase,
            bindingId,
            bindingRevision,
            outputs);
        return ValueTask.FromResult<AdmittedDependency?>(
            retained with
            {
                ObservedClaimRevision = observedClaimRevision,
                BindingPhase = phase,
                BindingId = bindingId,
                BindingRevision = bindingRevision,
                Outputs = outputs.Select(item =>
                {
                    var existing = retained.Outputs.SingleOrDefault(
                        output =>
                            output.Target.Kind == item.Kind
                            && output.Target.Purpose == item.Purpose);
                    return existing?.Target == item
                        ? existing
                        : new ResolvedConfigTarget(
                            item,
                            null,
                            null);
                }).ToArray()
            });
    }

    private static void ValidateBinding(
        Revision claimRevision,
        long observedClaimRevision,
        DependencyBindingPhase phase,
        BindingId? bindingId,
        Revision? bindingRevision,
        IReadOnlyList<ConfigTargetReference> outputs)
    {
        if (observedClaimRevision < 0
            || observedClaimRevision > claimRevision.Value
            || outputs.Count > 64
            || outputs.Select(item => (item.Kind, item.Purpose))
                .Distinct()
                .Count() != outputs.Count)
        {
            throw new InvalidOperationException(
                "Dependency binding status is invalid");
        }

        var ready = phase == DependencyBindingPhase.Ready;
        if (ready != (
                observedClaimRevision == claimRevision.Value
                && bindingId is not null
                && bindingRevision is not null)
            || (!ready && (
                bindingId is not null
                || bindingRevision is not null
                || outputs.Count != 0)))
        {
            throw new InvalidOperationException(
                "Dependency binding status is invalid");
        }
    }
}
