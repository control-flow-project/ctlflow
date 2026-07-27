using CtlFlow.Audit.Auditd.Domain.Sources;
using CtlFlow.Audit.Auditd.Service.Security.Workloads;

namespace CtlFlow.Audit.Auditd.Service.Security;

internal sealed record AuditSourceIdentity(
    AuditSource Source,
    KubernetesServiceAccountSubject Subject);
