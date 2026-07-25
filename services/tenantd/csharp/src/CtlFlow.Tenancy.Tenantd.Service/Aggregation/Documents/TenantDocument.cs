namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class TenantDocument
{
    public required string ApiVersion { get; init; }

    public required string Kind { get; init; }

    public required ObjectMetaDocument Metadata { get; init; }

    public required TenantSpecDocument Spec { get; init; }

    public ResourceStatusDocument? Status { get; init; }
}

internal sealed class TenantSpecDocument
{
    public required string DisplayName { get; init; }

    public required ExternalTenantAddressDocument Address { get; init; }

    public required InitialAdministratorDocument InitialAdministrator
    {
        get;
        init;
    }

    public required BaselinePackageDocument[] BaselinePackages { get; init; }
}

internal sealed class TenantListDocument
{
    public required string ApiVersion { get; init; }

    public required string Kind { get; init; }

    public required ListMetaDocument Metadata { get; init; }

    public required TenantDocument[] Items { get; init; }
}
