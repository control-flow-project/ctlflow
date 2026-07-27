using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Sessions;
using DomainIdentitySession =
    CtlFlow.Audit.Auditd.Domain.Details.IdentitySessionAuditDetail;
using WireIdentitySession =
    CtlFlow.Audit.V1.IdentitySessionAuditDetail;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainIdentitySession> MapIdentitySession(
        WireIdentitySession value,
        CancellationToken cancellation) =>
        new(
            await SessionId.Parse(value.SessionId, cancellation),
            await HumanAccountId.Parse(
                value.HumanAccountPrincipalId,
                cancellation),
            await ParseRevision(value.SessionRevision, cancellation),
            MapSessionAction(value.Action));
}
