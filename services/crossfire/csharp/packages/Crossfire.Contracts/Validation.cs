using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public static partial class Validation
{
    public const long MaxWireInteger = 9007199254740991;

    public static Result<string> Text(JsonElement input, int maximum = 255, int minimum = 1)
    {
        var parsed = input.ValueKind == JsonValueKind.String ? ProtocolJson.Unquote(input.GetRawText()) : Results.Fail<string>("invalid", "Expected text");
        var value = parsed.IsSuccess ? parsed.Value : null;
        return value is not null && value.Length >= minimum && value.Length <= maximum && !Controls().IsMatch(value)
            ? Result<string>.Success(value) : Results.Fail<string>("invalid", $"Expected text of {minimum}–{maximum} characters");
    }

    public static Result<string> PlainText(JsonElement input, int maximumBytes)
    {
        var parsed = input.ValueKind == JsonValueKind.String ? ProtocolJson.Unquote(input.GetRawText()) : Results.Fail<string>("invalid", "Expected plain text");
        var value = parsed.IsSuccess ? parsed.Value : null;
        return value is not null && Encoding.UTF8.GetByteCount(value) <= maximumBytes && !PlainControls().IsMatch(value)
            ? Result<string>.Success(value) : Results.Fail<string>("invalid", $"Expected plain text up to {maximumBytes} UTF-8 bytes");
    }

    public static Result<long> Integer(JsonElement input, long minimum = 0, long maximum = MaxWireInteger)
        => input.ValueKind == JsonValueKind.Number && input.TryGetDouble(out var number)
            && double.IsFinite(number) && Math.Truncate(number) == number && number >= minimum && number <= maximum
            && number is >= -MaxWireInteger and <= MaxWireInteger
                ? Result<long>.Success((long)number) : Results.Fail<long>("invalid", "Expected a bounded integer");

    public static Result<bool> Boolean(JsonElement input)
        => input.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? Result<bool>.Success(input.GetBoolean()) : Results.Fail<bool>("invalid", "Expected a boolean");

    public static Result<string?> NullableText(JsonElement input, int maximum = 255, int minimum = 1)
        => input.ValueKind == JsonValueKind.Null ? Result<string?>.Success(null) : Text(input, maximum, minimum).Map<string?>(value => value);

    public static Result<long?> NullableInteger(JsonElement input, long minimum = 0, long maximum = MaxWireInteger)
        => input.ValueKind == JsonValueKind.Null ? Result<long?>.Success(null) : Integer(input, minimum, maximum).Map<long?>(value => value);

    public static Result<bool?> NullableBoolean(JsonElement input)
        => input.ValueKind == JsonValueKind.Null ? Result<bool?>.Success(null) : Boolean(input).Map<bool?>(value => value);

    public static Result<string> Choice(JsonElement input, params string[] choices)
    {
        var parsed = input.ValueKind == JsonValueKind.String ? ProtocolJson.Unquote(input.GetRawText()) : Results.Fail<string>("invalid", "Expected a choice");
        return parsed.IsSuccess && choices.Contains(parsed.Value, StringComparer.Ordinal)
            ? parsed : Results.Fail<string>("invalid", "Choose one of: " + string.Join(", ", choices));
    }

    public static Result<JsonElement> Fields(JsonElement input, IReadOnlyList<string> required, IReadOnlyList<string>? optional = null)
    {
        if (input.ValueKind != JsonValueKind.Object) return Results.Fail<JsonElement>("invalid", "Expected an object");
        if (input.EnumerateObject().Any(field => !required.Contains(field.Name) && !(optional?.Contains(field.Name) ?? false))
            || required.Any(field => !input.TryGetProperty(field, out _)))
            return Results.Fail<JsonElement>("invalid", "Missing or unknown fields");
        return Result<JsonElement>.Success(input);
    }

    public static Result<IReadOnlyList<T>> List<T>(JsonElement input, Func<JsonElement, Result<T>> parse, int maximum = 100, int minimum = 0)
    {
        if (input.ValueKind != JsonValueKind.Array || input.GetArrayLength() < minimum || input.GetArrayLength() > maximum)
            return Results.Fail<IReadOnlyList<T>>("invalid", "Expected a bounded list");
        var values = new List<T>(input.GetArrayLength());
        foreach (var item in input.EnumerateArray())
        {
            var parsed = parse(item);
            if (!parsed.IsSuccess) return Result<IReadOnlyList<T>>.Fail(parsed.Error);
            values.Add(parsed.Value);
        }
        return Result<IReadOnlyList<T>>.Success(values);
    }

    public static bool Identifier(string value) => IdentitySyntax.Identifier(value);
    public static bool Name(string value) => IdentitySyntax.Name(value);
    public static bool UserId(string value) => IdentitySyntax.MatrixUser(value);
    public static bool RoomId(string value) => value.Length <= 255 && RoomPattern().IsMatch(value);
    public static bool EventId(string value) => value.Length <= 255 && EventPattern().IsMatch(value);
    public static bool Secret(string value) => SecretPattern().IsMatch(value);

    public static bool Json(JsonElement value, int depth = 0)
        => depth <= 64 && value.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.String or JsonValueKind.True or JsonValueKind.False => true,
            JsonValueKind.Number => value.TryGetDouble(out var number) && double.IsFinite(number),
            JsonValueKind.Array => value.EnumerateArray().All(item => Json(item, depth + 1)),
            JsonValueKind.Object => value.EnumerateObject().All(item => Json(item.Value, depth + 1)),
            _ => false
        };

    public static Result<string> Origin(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.UserInfo.Length != 0 || uri.Query.Length != 0
            || uri.Fragment.Length != 0 || uri.AbsolutePath != "/"
            || !(uri.Scheme == "https" || uri.Scheme == "http" && uri.Host is "127.0.0.1" or "[::1]" or "localhost"))
            return Results.Fail<string>("invalid", "Use HTTPS or a loopback HTTP origin without credentials");
        return Result<string>.Success(uri.GetLeftPart(UriPartial.Authority));
    }

    [GeneratedRegex("[\\x00-\\x1f\\x7f]", RegexOptions.CultureInvariant)]
    private static partial Regex Controls();
    [GeneratedRegex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]", RegexOptions.CultureInvariant)]
    private static partial Regex PlainControls();
    [GeneratedRegex("\\A![^\\x09-\\x0d\\x20\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+\\z", RegexOptions.CultureInvariant)]
    private static partial Regex RoomPattern();
    [GeneratedRegex("\\A\\$[^\\x09-\\x0d\\x20\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+\\z", RegexOptions.CultureInvariant)]
    private static partial Regex EventPattern();
    [GeneratedRegex("\\A[A-Za-z0-9_-]{43}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex SecretPattern();
}
