namespace CtlFlow.Execution.Execd.Domain.Resources;

public sealed record PageSize
{
    private PageSize(int value) => Value = value;
    public int Value { get; }

    public static PageSize Parse(uint value)
    {
        var resolved = value == 0 ? ExecutionLimits.DefaultPageSize : value;
        if (resolved > ExecutionLimits.MaximumPageSize)
        {
            throw new ArgumentException("page_size exceeds 100", nameof(value));
        }

        return new PageSize((int)resolved);
    }
}
