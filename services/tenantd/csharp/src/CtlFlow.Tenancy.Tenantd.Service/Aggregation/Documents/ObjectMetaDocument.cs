namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class ObjectMetaDocument
{
    public string? Name { get; init; }

    public string? ResourceVersion { get; init; }

    public DateTimeOffset? CreationTimestamp { get; init; }
}
