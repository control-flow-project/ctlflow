namespace CtlFlow.Tenancy.Tenantd.Db.Requests;

public class IdempotencyRecord
{
    private IdempotencyRecord()
    {
    }

    internal IdempotencyRecord(
        string recordId,
        string requestActor,
        string operationName,
        string idempotencyKey,
        string requestHash,
        int resourceKind,
        string resourceId,
        string? lifecycleOperationId,
        long resultResourceRevision,
        int resultLifecycleState,
        long resultProvisioningGeneration,
        long? resultStepRevision,
        int? resultStepState,
        long resultEventSequence,
        long createdAtUnixMilliseconds)
    {
        RecordId = recordId;
        RequestActor = requestActor;
        OperationName = operationName;
        IdempotencyKey = idempotencyKey;
        RequestHash = requestHash;
        ResourceKind = resourceKind;
        ResourceId = resourceId;
        LifecycleOperationId = lifecycleOperationId;
        ResultResourceRevision = resultResourceRevision;
        ResultLifecycleState = resultLifecycleState;
        ResultProvisioningGeneration = resultProvisioningGeneration;
        ResultStepRevision = resultStepRevision;
        ResultStepState = resultStepState;
        ResultEventSequence = resultEventSequence;
        CreatedAtUnixMilliseconds = createdAtUnixMilliseconds;
    }

    public string RecordId { get; private set; } = string.Empty;
    public string RequestActor { get; private set; } = string.Empty;
    public string OperationName { get; private set; } = string.Empty;
    public string IdempotencyKey { get; private set; } = string.Empty;
    public string RequestHash { get; private set; } = string.Empty;
    public int ResourceKind { get; private set; }
    public string ResourceId { get; private set; } = string.Empty;
    public string? LifecycleOperationId { get; private set; }
    public long ResultResourceRevision { get; private set; }
    public int ResultLifecycleState { get; private set; }
    public long ResultProvisioningGeneration { get; private set; }
    public long? ResultStepRevision { get; private set; }
    public int? ResultStepState { get; private set; }
    public long ResultEventSequence { get; private set; }
    public long CreatedAtUnixMilliseconds { get; private set; }
}
