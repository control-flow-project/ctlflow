using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static bool ValidateAuditAcceptances(
        AuditOutboxLease lease,
        RecordAuditBatchResponse response)
    {
        if (response.Acceptances.Count != lease.Events.Count)
        {
            return false;
        }

        for (var index = 0; index < lease.Events.Count; index++)
        {
            var acceptance = response.Acceptances[index];
            if (acceptance.SourceEventId
                    != lease.Events[index].SourceEventId.Value
                || acceptance.PartitionCursor == 0)
            {
                return false;
            }
        }

        return true;
    }
}
