namespace CtlFlow.Tenancy.Tenantd.Db.Sqlite;

public readonly record struct DatabasePoolSize
{
    private DatabasePoolSize(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static ValueTask<DatabasePoolSize> Parse(
        int value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (value is < 1 or > 128)
        {
            throw new ArgumentOutOfRangeException(
                nameof(value),
                "Database pool size must be between one and 128");
        }

        return ValueTask.FromResult(new DatabasePoolSize(value));
    }
}
