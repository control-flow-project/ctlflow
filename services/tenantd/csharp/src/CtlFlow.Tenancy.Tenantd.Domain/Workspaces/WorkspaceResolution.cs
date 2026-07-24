using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceResolution(
    WorkspaceId WorkspaceId,
    WorkspaceLifecycle Lifecycle,
    WorkspaceRevision Revision,
    AddressBindingGeneration AddressBindingGeneration,
    CacheExpiry CacheExpiry);
