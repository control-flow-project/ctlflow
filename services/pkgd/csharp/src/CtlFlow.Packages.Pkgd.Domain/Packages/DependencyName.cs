using System.Globalization;
using System.Text;

namespace CtlFlow.Packages.Pkgd.Domain.Packages;

public sealed record DependencyName
{
    private DependencyName(string value) => Value = value;

    public string Value { get; }

    public static ValueTask<DependencyName> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Create(value, stored: false));
    }

    public static DependencyName FromStorage(string value) =>
        Create(value, stored: true);

    private static DependencyName Create(string value, bool stored)
    {
        var valid = value.IsNormalized(NormalizationForm.FormC);
        var count = 0;
        Rune first = default;
        Rune last = default;
        foreach (var rune in value.EnumerateRunes())
        {
            if (count == 0)
            {
                first = rune;
            }

            last = rune;
            count++;
            valid &= Rune.GetUnicodeCategory(rune) is not (
                UnicodeCategory.Control
                or UnicodeCategory.Format
                or UnicodeCategory.PrivateUse
                or UnicodeCategory.OtherNotAssigned
                or UnicodeCategory.LineSeparator
                or UnicodeCategory.ParagraphSeparator);
        }

        valid &= count is >= 1 and <= 200
            && !Rune.IsWhiteSpace(first)
            && !Rune.IsWhiteSpace(last);
        if (!valid)
        {
            throw stored
                ? new InvalidOperationException(
                    "Stored dependency name is not canonical")
                : new ArgumentException(
                    "Dependency name is not canonical");
        }

        return new DependencyName(value);
    }
}
