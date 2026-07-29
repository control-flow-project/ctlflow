using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public static partial class Workloads
{
    public static ValueTask<AdmittedInterface?> ApplyInterfaceEndpoint(
        WorkloadRecord current,
        Revision expectedRevision,
        InterfaceId interfaceId,
        EndpointHost? host,
        bool ready,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (current.Revision != expectedRevision)
        {
            return ValueTask.FromResult<AdmittedInterface?>(null);
        }

        var retained = current.Interfaces.SingleOrDefault(
            item => item.InterfaceId == interfaceId);
        return ValueTask.FromResult(
            retained is null
                ? null
                : retained with { Host = host, Ready = ready });
    }
}
