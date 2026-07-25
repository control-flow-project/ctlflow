namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

public class PageCursor
{
    private PageCursor()
    {
    }

    internal PageCursor(
        string pageToken,
        int resourceKind,
        string requestActor,
        string visibilityHash,
        string? tenantFilter,
        string lastResourceId,
        long snapshotSequence,
        long expiresAtUnixMilliseconds)
    {
        PageToken = pageToken;
        ResourceKind = resourceKind;
        RequestActor = requestActor;
        VisibilityHash = visibilityHash;
        TenantFilter = tenantFilter;
        LastResourceId = lastResourceId;
        SnapshotSequence = snapshotSequence;
        ExpiresAtUnixMilliseconds = expiresAtUnixMilliseconds;
    }

    public string PageToken { get; private set; } = string.Empty;

    public int ResourceKind { get; private set; }

    public string RequestActor { get; private set; } = string.Empty;

    public string VisibilityHash { get; private set; } = string.Empty;

    public string? TenantFilter { get; private set; }

    public string LastResourceId { get; private set; } = string.Empty;

    public long SnapshotSequence { get; private set; }

    public long ExpiresAtUnixMilliseconds { get; private set; }
}
