namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class ListMetaDocument
{
    public required string ResourceVersion { get; init; }

    public string? Continue { get; init; }
}
