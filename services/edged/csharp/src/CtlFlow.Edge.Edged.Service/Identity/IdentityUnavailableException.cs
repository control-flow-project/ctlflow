namespace CtlFlow.Edge.Edged.Service.Identity;

internal sealed class IdentityUnavailableException(Exception innerException)
    : Exception("Identityd is unavailable", innerException);
