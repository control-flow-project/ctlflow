using CtlFlow.Audit.Auditd.Domain.Resources;

namespace CtlFlow.Audit.Auditd.Service.Grpc.Requests;

internal static partial class AuditRequests
{
    private static async ValueTask<Revision> ParseRevision(
        ulong value,
        CancellationToken cancellation) =>
        await Revision.Parse(checked((long)value), cancellation);

    private static async ValueTask<Generation> ParseGeneration(
        ulong value,
        CancellationToken cancellation) =>
        await Generation.Parse(checked((long)value), cancellation);
}
