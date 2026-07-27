using CtlFlow.Audit.Auditd.Domain.Consumers;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Placements;
using CtlFlow.Audit.V1;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<ConsumerBinding> MapConsumerBinding(
        ConsumerBindingAuditDetail? value,
        CancellationToken cancellation)
    {
        if (value is null)
        {
            throw new ArgumentException("Consumer binding is required");
        }

        return new ConsumerBinding(
            await PlacementId.Parse(value.PlacementId, cancellation),
            await MapPlacementTarget(
                value.PlacementTarget,
                cancellation),
            await ConsumerId.Parse(value.ConsumerId, cancellation),
            await ConsumerPurpose.Parse(value.Purpose, cancellation));
    }
}
