namespace CtlFlow.Identity.Identityd.Domain.Collections;

public static partial class Pages
{
    public static ValueTask<Page<T>> CreatePage<T>(
        IReadOnlyList<T> candidates,
        PageSize pageSize,
        Func<T, string> keyOf,
        CancellationToken cancellation,
        Comparison<string>? compare = null)
    {
        cancellation.ThrowIfCancellationRequested();
        Comparison<string> compareKeys = compare ?? string.CompareOrdinal;
        if (candidates.Count > pageSize.Value + 1)
        {
            throw new InvalidOperationException(
                "Page query exceeded its admitted bound");
        }

        for (var index = 1; index < candidates.Count; index++)
        {
            if (compareKeys(
                    keyOf(candidates[index - 1]),
                    keyOf(candidates[index])) >= 0)
            {
                throw new InvalidOperationException(
                    "Stored page is not strictly ordered");
            }
        }

        var hasNext = candidates.Count > pageSize.Value;
        var page = candidates.Take(pageSize.Value).ToArray();
        return ValueTask.FromResult(
            new Page<T>(
                page,
                hasNext ? keyOf(page[^1]) : null));
    }
}
