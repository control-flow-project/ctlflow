namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<IReadOnlyList<AdmittedDependency>>
        RetainDependencyState(
            IReadOnlyList<AdmittedDependency> requested,
            IReadOnlyList<AdmittedDependency> current,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var existing = current.ToDictionary(
            item => (
                item.Selection.ComponentId,
                item.Selection.Name));
        var result = new List<AdmittedDependency>(requested.Count);
        foreach (var dependency in requested)
        {
            var key = (
                dependency.Selection.ComponentId,
                dependency.Selection.Name);
            if (existing.TryGetValue(key, out var retained)
                && HasSameDependencyDeclaration(
                    retained,
                    dependency))
            {
                result.Add(dependency with
                {
                    ClaimRevision = retained.ClaimRevision,
                    ObservedClaimRevision =
                        retained.ObservedClaimRevision,
                    BindingPhase = retained.BindingPhase,
                    BindingId = retained.BindingId,
                    BindingRevision = retained.BindingRevision,
                    Outputs = retained.Outputs
                });
                continue;
            }

            result.Add(dependency with
            {
                ClaimRevision = retained is null
                    ? Resources.Revision.Initial()
                    : retained.ClaimRevision.Next(),
                ObservedClaimRevision = 0,
                BindingPhase =
                    Resources.DependencyBindingPhase.Pending,
                BindingId = null,
                BindingRevision = null,
                Outputs = []
            });
        }

        return ValueTask.FromResult<
            IReadOnlyList<AdmittedDependency>>(result);
    }
}
