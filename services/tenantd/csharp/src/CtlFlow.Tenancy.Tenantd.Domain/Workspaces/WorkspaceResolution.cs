using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceResolution(
    WorkspaceId WorkspaceId,
    LifecycleState Lifecycle,
    WorkspaceRevision Revision,
    AddressBindingGeneration AddressBindingGeneration,
    CacheExpiry CacheExpiry);
