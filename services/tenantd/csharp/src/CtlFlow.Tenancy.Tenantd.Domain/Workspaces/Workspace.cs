using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public class Workspace
{
    private string _id = string.Empty;
    private string _tenantId = string.Empty;

    private Workspace()
    {
    }

    public WorkspaceId Id => WorkspaceId.FromStorage(_id);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceDisplayName DisplayName { get; private set; } = null!;

    public WorkspaceLifecycle Lifecycle { get; private set; }

    public WorkspaceRevision Revision { get; private set; } = null!;

    public WorkspaceProvisioningGeneration ProvisioningGeneration { get; private set; } = null!;

    public UtcInstant CreatedAt { get; private set; } = null!;

    public UtcInstant UpdatedAt { get; private set; } = null!;
}
