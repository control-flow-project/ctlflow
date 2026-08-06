namespace CtlFlow.Packages.Pkgd.Domain.Packages;

// A product operation a component implements. The token uses the canonical
// `<plural_resource>.<action>` grammar: exactly one dot, with lower-case ASCII
// letters, digits, and `_` inside each non-empty part.
//
// The Package ID supplies the namespace, so two packages may declare the same
// token and a package may reuse a token a kernel service also uses. Pkgd holds
// no copy of Policyd's kernel catalog and evaluates no policy: a declaration
// states what a component implements, never who may invoke it.
public sealed record DeclaredOperation
{
    private const int MaximumLength = 128;

    private DeclaredOperation(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<DeclaredOperation> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new DeclaredOperation(Validate(value)));
    }

    public static DeclaredOperation FromStorage(string value) =>
        new(Validate(value));

    private static string Validate(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length is < 3 or > MaximumLength)
        {
            throw new ArgumentException(
                "Declared operation is not canonical",
                nameof(value));
        }

        var separator = value.IndexOf('.');
        if (separator < 1
            || separator != value.LastIndexOf('.')
            || separator == value.Length - 1)
        {
            throw new ArgumentException(
                "Declared operation is not canonical",
                nameof(value));
        }

        foreach (var character in value)
        {
            if (character != '.'
                && character is not (>= 'a' and <= 'z')
                    and not (>= '0' and <= '9')
                    and not '_')
            {
                throw new ArgumentException(
                    "Declared operation is not canonical",
                    nameof(value));
            }
        }

        return value;
    }
}
