using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal static partial class ConfigdRequests
{
    internal static ValueTask<DependencyClaimSelector?>
        CreateDependencyClaimSelector(
            bool hasId,
            string id,
            bool hasRevision,
            ulong revision,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (hasId != hasRevision)
        {
            throw new ArgumentException(
                "Dependency claim ID and revision must appear together");
        }

        return ValueTask.FromResult(
            hasId
                ? new DependencyClaimSelector(
                    DependencyClaimId.Parse(id),
                    Revision.Parse(revision))
                : null);
    }
}
