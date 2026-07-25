namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class WorkspaceDocument
{
    public required string ApiVersion { get; init; }

    public required string Kind { get; init; }

    public required ObjectMetaDocument Metadata { get; init; }

    public required WorkspaceSpecDocument Spec { get; init; }

    public ResourceStatusDocument? Status { get; init; }
}

internal sealed class WorkspaceSpecDocument
{
    public required string TenantId { get; init; }

    public required string DisplayName { get; init; }

    public required string WorkspaceAddress { get; init; }

    public required InitialMembershipDocument[] InitialMemberships
    {
        get;
        init;
    }

    public required BaselinePackageDocument[] BaselinePackages { get; init; }
}

internal sealed class WorkspaceListDocument
{
    public required string ApiVersion { get; init; }

    public required string Kind { get; init; }

    public required ListMetaDocument Metadata { get; init; }

    public required WorkspaceDocument[] Items { get; init; }
}
