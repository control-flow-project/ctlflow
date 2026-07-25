namespace CtlFlow.Tenancy.Tenantd.Domain.Provisioning;

public sealed record BaselinePackageIntent(
    PackageId PackageId,
    PackageVersion PackageVersion);
