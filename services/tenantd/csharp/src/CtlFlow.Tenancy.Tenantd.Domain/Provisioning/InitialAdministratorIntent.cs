namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record InitialAdministratorIntent(
    AdministratorDisplayName DisplayName,
    LoginIdentifier LoginIdentifier,
    IdentityLinkIntent? IdentityLink);
