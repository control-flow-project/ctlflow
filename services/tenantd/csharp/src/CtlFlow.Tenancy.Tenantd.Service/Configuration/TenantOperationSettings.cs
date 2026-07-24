using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

public sealed record TenantOperationSettings(
    CacheLifetime CacheLifetime,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveTenantCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveWorkspaceCallers);
