namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

public class ResourceEvent
{
    private ResourceEvent()
    {
    }

    internal ResourceEvent(
        long eventSequence,
        int resourceKind,
        int eventKind,
        string tenantId,
        string? workspaceId,
        string displayName,
        int lifecycleState,
        long resourceRevision,
        long provisioningGeneration,
        string? currentOperationId,
        long eventAtUnixMilliseconds)
    {
        EventSequence = eventSequence;
        ResourceKind = resourceKind;
        EventKind = eventKind;
        TenantId = tenantId;
        WorkspaceId = workspaceId;
        DisplayName = displayName;
        LifecycleState = lifecycleState;
        ResourceRevision = resourceRevision;
        ProvisioningGeneration = provisioningGeneration;
        CurrentOperationId = currentOperationId;
        EventAtUnixMilliseconds = eventAtUnixMilliseconds;
    }

    public long EventSequence { get; private set; }

    public int ResourceKind { get; private set; }

    public int EventKind { get; private set; }

    public string TenantId { get; private set; } = string.Empty;

    public string? WorkspaceId { get; private set; }

    public string DisplayName { get; private set; } = string.Empty;

    public int LifecycleState { get; private set; }

    public long ResourceRevision { get; private set; }

    public long ProvisioningGeneration { get; private set; }

    public string? CurrentOperationId { get; private set; }

    public long EventAtUnixMilliseconds { get; private set; }
}
