namespace CtlFlow.Identity.Identityd.Service.Auditing;

internal sealed class AuditUnavailableException(Exception innerException)
    : Exception("Audit delivery is unavailable", innerException);
