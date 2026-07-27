using CtlFlow.Audit.Auditd.Domain.Tenants;
using DomainPartition =
    CtlFlow.Audit.Auditd.Domain.Events.AuditPartition;
using DomainPartitionKind =
    CtlFlow.Audit.Auditd.Domain.Events.AuditPartitionKind;
using WirePartition = CtlFlow.Audit.V1.AuditPartition;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<DomainPartition> MapAuditPartition(
        WirePartition? value,
        CancellationToken cancellation)
    {
        if (value is null)
        {
            throw new ArgumentException("Audit partition is required");
        }

        return value.PartitionCase switch
        {
            WirePartition.PartitionOneofCase.Global =>
                new DomainPartition(DomainPartitionKind.Global, null),
            WirePartition.PartitionOneofCase.Tenant =>
                new DomainPartition(
                    DomainPartitionKind.Tenant,
                    await TenantId.Parse(
                        value.Tenant.TenantId,
                        cancellation)),
            _ => throw new ArgumentException(
                "Audit partition is required")
        };
    }
}
