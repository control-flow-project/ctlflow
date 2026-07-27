using System.Globalization;
using Microsoft.Extensions.Primitives;

namespace CtlFlow.Auth.Authd.Service.Http;

internal enum CookieReadState
{
    Missing,
    Valid,
    Invalid
}

internal readonly record struct CookieReadResult(
    CookieReadState State,
    string? Value)
{
    public override string ToString() => "[REDACTED]";
}

internal static class BrowserCookies
{
    internal const string StateName = "__Host-ctlflow-auth-state";
    internal const string SessionName = "__Host-ctlflow-session";
    private const int MaximumCookieBytes = 8 * 1024;
    private const string Attributes =
        "Path=/; Secure; HttpOnly; SameSite=Lax";

    internal static string ClearStateCookie { get; } =
        $"{StateName}=; {Attributes}; Max-Age=0; "
        + "Expires=Thu, 01 Jan 1970 00:00:00 GMT";

    internal static string ClearSessionCookie { get; } =
        $"{SessionName}=; {Attributes}; Max-Age=0; "
        + "Expires=Thu, 01 Jan 1970 00:00:00 GMT";

    internal static CookieReadResult Read(
        HttpRequest request,
        string name)
    {
        var values = request.Headers.Cookie;
        var total = 0;
        foreach (var value in values)
        {
            total = checked(total + (value?.Length ?? 0));
        }
        if (total > MaximumCookieBytes)
        {
            throw new HttpContractException(
                StatusCodes.Status431RequestHeaderFieldsTooLarge,
                "cookie_too_large");
        }

        string? found = null;
        foreach (var header in values)
        {
            if (header is null)
            {
                continue;
            }
            foreach (var segment in header.Split(';'))
            {
                var item = segment.Trim();
                var separator = item.IndexOf('=');
                if (separator <= 0
                    || !string.Equals(
                        item[..separator],
                        name,
                        StringComparison.Ordinal))
                {
                    continue;
                }

                if (found is not null)
                {
                    return new CookieReadResult(
                        CookieReadState.Invalid,
                        null);
                }
                found = item[(separator + 1)..];
            }
        }

        if (found is null)
        {
            return new CookieReadResult(CookieReadState.Missing, null);
        }
        return BrowserValues.IsCanonical32ByteValue(found)
            ? new CookieReadResult(CookieReadState.Valid, found)
            : new CookieReadResult(CookieReadState.Invalid, null);
    }

    internal static string CreateStateCookie(string value) =>
        $"{StateName}={value}; {Attributes}; Max-Age=600";

    internal static string CreateSessionCookie(
        string value,
        DateTimeOffset expiresAt,
        DateTimeOffset currentTime)
    {
        var lifetime = expiresAt - currentTime;
        var seconds = (long)Math.Floor(lifetime.TotalSeconds);
        if (seconds is < 1 or > 30 * 24 * 60 * 60)
        {
            throw new InvalidDataException(
                "Identityd returned an invalid Session expiry");
        }

        return $"{SessionName}={value}; {Attributes}; "
            + $"Max-Age={seconds.ToString(CultureInfo.InvariantCulture)}; "
            + $"Expires={expiresAt.UtcDateTime.ToString("R", CultureInfo.InvariantCulture)}";
    }
}
