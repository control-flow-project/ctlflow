namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class ApiResourceListDocument
{
    public required string ApiVersion { get; init; }

    public required string GroupVersion { get; init; }

    public required string Kind { get; init; }

    public required ApiResourceDocument[] Resources { get; init; }
}

internal sealed class ApiResourceDocument
{
    public required string Name { get; init; }

    public required string SingularName { get; init; }

    public bool Namespaced { get; init; }

    public required string Kind { get; init; }

    public required string[] Verbs { get; init; }
}
