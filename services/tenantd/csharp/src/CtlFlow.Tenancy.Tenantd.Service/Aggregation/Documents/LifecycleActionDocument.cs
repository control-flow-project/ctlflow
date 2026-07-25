namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class LifecycleActionDocument
{
    public required string ApiVersion { get; init; }

    public required string Kind { get; init; }

    public required string ResourceVersion { get; init; }
}
