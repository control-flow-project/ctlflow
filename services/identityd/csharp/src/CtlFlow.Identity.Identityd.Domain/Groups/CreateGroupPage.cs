using CtlFlow.Identity.Identityd.Domain.Collections;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public static partial class Groups
{
    public static ValueTask<GroupPage> CreateGroupPage(
        IReadOnlyList<GroupId> candidates,
        PageSize pageSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (candidates.Count > pageSize.Value + 1)
        {
            throw new InvalidOperationException(
                "Group query exceeded its admitted bound");
        }

        for (var index = 1; index < candidates.Count; index++)
        {
            if (string.CompareOrdinal(
                    candidates[index - 1].Value,
                    candidates[index].Value) >= 0)
            {
                throw new InvalidOperationException(
                    "Stored Group page is not strictly ordered");
            }
        }

        var hasNext = candidates.Count > pageSize.Value;
        var page = candidates.Take(pageSize.Value).ToArray();
        return ValueTask.FromResult(
            new GroupPage(
                page,
                hasNext ? page[^1] : null));
    }
}
