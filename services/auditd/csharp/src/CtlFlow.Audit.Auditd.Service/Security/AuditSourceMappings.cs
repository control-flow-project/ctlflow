using CtlFlow.Audit.Auditd.Domain.Sources;
using CtlFlow.Audit.Auditd.Service.Security.Workloads;

namespace CtlFlow.Audit.Auditd.Service.Security;

internal sealed class AuditSourceMappings
{
    private readonly IReadOnlyDictionary<
        KubernetesServiceAccountSubject,
        AuditSource> _sources;

    internal AuditSourceMappings(
        KubernetesServiceAccountSubject tenantd,
        KubernetesServiceAccountSubject identityd,
        KubernetesServiceAccountSubject pkgd,
        KubernetesServiceAccountSubject configd,
        KubernetesServiceAccountSubject execd)
    {
        var values = new Dictionary<
            KubernetesServiceAccountSubject,
            AuditSource>
        {
            [tenantd] = AuditSource.Tenantd,
            [identityd] = AuditSource.Identityd,
            [pkgd] = AuditSource.Pkgd,
            [configd] = AuditSource.Configd,
            [execd] = AuditSource.Execd
        };
        if (values.Count != 5)
        {
            throw new InvalidOperationException(
                "Audit source subjects must be distinct");
        }

        _sources = values;
    }

    internal AuditSource Resolve(KubernetesServiceAccountSubject subject) =>
        _sources.TryGetValue(subject, out var source)
            ? source
            : throw new CallerNotAdmittedException();

    internal int Count => _sources.Count;
}
