namespace CtlFlow.Audit.Auditd.Domain.Sources;

public enum AuditSource
{
    Tenantd = 1,
    Identityd = 2,
    Pkgd = 3,
    Configd = 4,
    Execd = 5
}

internal static class AuditSources
{
    internal static string ToPrincipal(AuditSource source) =>
        source switch
        {
            AuditSource.Tenantd => "SERVICE/svc_tenantd",
            AuditSource.Identityd => "SERVICE/svc_identityd",
            AuditSource.Pkgd => "SERVICE/svc_pkgd",
            AuditSource.Configd => "SERVICE/svc_configd",
            AuditSource.Execd => "SERVICE/svc_execd",
            _ => throw new InvalidOperationException("Unknown audit source")
        };

    internal static AuditSource FromPrincipal(string value) =>
        value switch
        {
            "SERVICE/svc_tenantd" => AuditSource.Tenantd,
            "SERVICE/svc_identityd" => AuditSource.Identityd,
            "SERVICE/svc_pkgd" => AuditSource.Pkgd,
            "SERVICE/svc_configd" => AuditSource.Configd,
            "SERVICE/svc_execd" => AuditSource.Execd,
            _ => throw new InvalidOperationException(
                "Stored audit source is invalid")
        };
}
