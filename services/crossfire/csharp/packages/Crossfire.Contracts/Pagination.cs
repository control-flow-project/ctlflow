using System.Globalization;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public static class Pagination
{
    public static Result<(int Page, int PageSize)> Parse(IReadOnlyDictionary<string, string> values)
    {
        static int Number(string text, int maximum) => text.Length > 0 && text[0] is >= '1' and <= '9'
            && text.All(character => character is >= '0' and <= '9')
            && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value <= maximum ? value : 0;
        var page = Number(values.GetValueOrDefault("page", "1"), 100000);
        var size = Number(values.GetValueOrDefault("pageSize", "20"), 100);
        return page > 0 && size > 0 ? Result<(int, int)>.Success((page, size))
            : Results.Fail<(int, int)>("invalid", "Use page ≥ 1 and pageSize 1–100");
    }
}
