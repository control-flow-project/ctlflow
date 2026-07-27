using CtlFlow.Audit.Auditd.Domain.Principals;
using CtlFlow.Audit.Auditd.Domain.Sources;
using DomainAttribution =
    CtlFlow.Audit.Auditd.Domain.Events.AuditAttribution;
using DomainAttributionKind =
    CtlFlow.Audit.Auditd.Domain.Events.AuditAttributionKind;
using WireAttribution = CtlFlow.Audit.V1.AuditAttribution;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainAttribution> MapAuditAttribution(
        WireAttribution? value,
        CancellationToken cancellation)
    {
        if (value is null)
        {
            throw new ArgumentException("Attribution is required");
        }

        return value.AttributionCase switch
        {
            WireAttribution.AttributionOneofCase.OperatorCommonName =>
                new DomainAttribution(
                    DomainAttributionKind.Operator,
                    await OperatorCommonName.Parse(
                        value.OperatorCommonName,
                        cancellation),
                    null,
                    null,
                    null,
                    null),
            WireAttribution.AttributionOneofCase.WorkloadSubject =>
                new DomainAttribution(
                    DomainAttributionKind.Workload,
                    null,
                    await WorkloadSubject.Parse(
                        value.WorkloadSubject,
                        cancellation),
                    null,
                    null,
                    null),
            WireAttribution.AttributionOneofCase.Invocation =>
                new DomainAttribution(
                    DomainAttributionKind.Invocation,
                    null,
                    null,
                    await PrincipalId.Parse(
                        value.Invocation.ActorPrincipalId,
                        cancellation),
                    await AccountId.Parse(
                        value.Invocation.AttachedAccountPrincipalId,
                        cancellation),
                    await WorkloadSubject.Parse(
                        value.Invocation.WorkloadSubject,
                        cancellation)),
            _ => throw new ArgumentException(
                "Attribution is required")
        };
    }
}
