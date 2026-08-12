using CtlFlow.Identity.Identityd.Service.Security.Workloads;

namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal sealed record IdentityAdminSettings(
    IReadOnlyDictionary<
        IdentityAdminOperation,
        IReadOnlySet<KubernetesServiceAccountSubject>> Callers)
{
    internal IReadOnlySet<KubernetesServiceAccountSubject> GetCallers(
        IdentityAdminOperation operation) =>
        Callers.TryGetValue(operation, out var callers)
            ? callers
            : throw new InvalidOperationException(
                "Identity administration operation is not configured");
}
