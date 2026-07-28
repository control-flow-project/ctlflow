namespace CtlFlow.Configuration.Configd.Db.Sqlite;

public readonly record struct DatabaseFilePath
{
    private DatabaseFilePath(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static ValueTask<DatabaseFilePath> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
        {
            throw new ArgumentException(
                "Database path must be a nonempty absolute file path",
                nameof(value));
        }

        return ValueTask.FromResult(new DatabaseFilePath(Path.GetFullPath(value)));
    }

    public override string ToString() => Value;
}
