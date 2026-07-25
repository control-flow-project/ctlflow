namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal sealed class AuditWorkloadToken
{
    private readonly string _material;

    internal AuditWorkloadToken(string material)
    {
        _material = material;
    }

    internal string ReadForAuthorization() => _material;

    public override string ToString() => "[REDACTED]";
}
