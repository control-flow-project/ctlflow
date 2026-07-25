using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal static partial class AggregationRequests
{
    internal static async ValueTask<
        IReadOnlyList<InitialWorkspaceMembershipIntent>>
        ParseInitialMemberships(
            InitialMembershipDocument[]? documents,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (documents is null)
        {
            throw new InvalidFieldException(
                "spec.initialMemberships",
                "initialMemberships is required",
                "FieldValueRequired");
        }

        if (documents.Length > 256)
        {
            throw new InvalidFieldException(
                "spec.initialMemberships",
                "initialMemberships exceeds 256 entries");
        }

        var memberships =
            new List<InitialWorkspaceMembershipIntent>(documents.Length);
        var userIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var document in documents)
        {
            try
            {
                var userId = await UserId.Parse(
                    document.UserId,
                    cancellation);
                if (!userIds.Add(userId.Value))
                {
                    throw new InvalidFieldException(
                        "spec.initialMemberships",
                        "initialMemberships contains a duplicate user ID",
                        "FieldValueDuplicate");
                }

                memberships.Add(new InitialWorkspaceMembershipIntent(
                    userId,
                    ParseMembershipStanding(document.Standing)));
            }
            catch (ArgumentException exception)
            {
                throw new InvalidFieldException(
                    "spec.initialMemberships",
                    exception.Message);
            }
        }

        memberships.Sort(static (left, right) =>
            string.CompareOrdinal(left.UserId.Value, right.UserId.Value));
        return memberships;
    }

    private static MembershipStanding ParseMembershipStanding(
        string standing) =>
        standing switch
        {
            "admin" => MembershipStanding.Admin,
            "member" => MembershipStanding.Member,
            _ => throw new ArgumentException(
                "Membership standing is not supported",
                nameof(standing))
        };
}
