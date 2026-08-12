namespace CtlFlow.Identity.Identityd.Service.Authorization;

internal sealed class PolicyUnavailableException(Exception innerException)
    : Exception("Policy dependency is unavailable", innerException);
