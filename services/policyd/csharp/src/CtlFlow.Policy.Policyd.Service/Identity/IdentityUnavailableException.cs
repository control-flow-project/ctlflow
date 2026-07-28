namespace CtlFlow.Policy.Policyd.Service.Identity;

internal sealed class IdentityUnavailableException(Exception innerException)
    : Exception("Identityd is unavailable", innerException);
