namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class ResourceStatusDocument
{
    public required string Lifecycle { get; init; }

    public long Revision { get; init; }

    public long ProvisioningGeneration { get; init; }

    public CurrentOperationDocument? CurrentOperation { get; init; }

    public required ConditionDocument[] Conditions { get; init; }
}

internal sealed class CurrentOperationDocument
{
    public required string Id { get; init; }

    public required string Kind { get; init; }
}

internal sealed class ConditionDocument
{
    public required string Owner { get; init; }

    public required string State { get; init; }

    public long? OwnerRevision { get; init; }

    public string? Reason { get; init; }

    public DateTimeOffset LastTransitionTime { get; init; }
}
