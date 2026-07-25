namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal sealed record LifecycleDeliveryRow(
    long DeliverySequence,
    string OperationId,
    long StepRevision);
