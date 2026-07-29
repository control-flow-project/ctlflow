namespace CtlFlow.Execution.Execd.Domain.Auditing;

public enum PlacementAuditAction
{
    Declared,
    Updated
}

public enum WorkloadAuditAction
{
    Declared,
    Updated
}

public enum RunAuditAction
{
    Created,
    CancellationRequested
}
