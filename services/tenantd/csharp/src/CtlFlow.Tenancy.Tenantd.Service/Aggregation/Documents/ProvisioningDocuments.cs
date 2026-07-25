namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class ExternalTenantAddressDocument
{
    public required string Authority { get; init; }

    public required string PathPrefix { get; init; }
}

internal sealed class InitialAdministratorDocument
{
    public required string DisplayName { get; init; }

    public required string LoginIdentifier { get; init; }

    public IdentityLinkDeclarationDocument? IdentityLink { get; init; }
}

internal sealed class IdentityLinkDeclarationDocument
{
    public required string ProviderId { get; init; }

    public required string ProviderSubject { get; init; }
}

internal sealed class BaselinePackageDocument
{
    public required string PackageId { get; init; }

    public required string PackageVersion { get; init; }
}

internal sealed class InitialMembershipDocument
{
    public required string UserId { get; init; }

    public required string Standing { get; init; }
}
