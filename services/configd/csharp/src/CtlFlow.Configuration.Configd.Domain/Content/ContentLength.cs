namespace CtlFlow.Configuration.Configd.Domain.Content;

public sealed record ContentLength
{
    private ContentLength(int value) => Value = value;

    public int Value { get; }

    public static ContentLength FromValidatedContent(int value) =>
        value is >= 1 and <= 65_536
            ? new ContentLength(value)
            : throw new ArgumentException(
                "Content length is outside the admitted bound",
                nameof(value));

    public static ContentLength FromStorage(int value) =>
        value is >= 1 and <= 65_536
            ? new ContentLength(value)
            : throw new InvalidOperationException(
                "Stored content length is invalid");
}
