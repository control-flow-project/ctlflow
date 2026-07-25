using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record TenantOperationSettings(
    CacheLifetime CacheLifetime,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveTenantCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> ResolveWorkspaceCallers,
    IReadOnlySet<KubernetesServiceAccountSubject> GetLifecycleCallers,
    LifecycleOwnerCallers LifecycleOwners,
    PageCursorLifetime PageCursorLifetime,
    WatchLifetime WatchLifetime);
