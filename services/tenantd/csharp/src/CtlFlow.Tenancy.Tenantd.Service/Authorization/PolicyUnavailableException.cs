namespace CtlFlow.Tenancy.Tenantd.Service.Authorization;

internal sealed class PolicyUnavailableException(Exception innerException)
    : Exception("The policy authority is unavailable", innerException);
