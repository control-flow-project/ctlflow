using CtlFlow.Edge.Edged.Service.Identity;

namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    private const string SessionCookieName =
        "__Host-ctlflow-session";

    internal static ParsedCookies? ExtractSessionCookie(
        IHeaderDictionary headers)
    {
        SessionCredential? credential = null;
        var applicationCookies = new List<string>();
        foreach (var header in headers.Cookie)
        {
            foreach (var segment in (header ?? "").Split(';'))
            {
                var cookie = segment.Trim();
                if (cookie.Length == 0)
                {
                    continue;
                }

                var separator = cookie.IndexOf('=');
                var name = separator < 0
                    ? cookie
                    : cookie[..separator].Trim();
                if (!string.Equals(
                        name,
                        SessionCookieName,
                        StringComparison.Ordinal))
                {
                    applicationCookies.Add(cookie);
                    continue;
                }

                if (credential is not null || separator < 0)
                {
                    credential?.Dispose();
                    return null;
                }

                credential = SessionCredential.ParseCookie(
                    cookie[(separator + 1)..].Trim());
                if (credential is null)
                {
                    return null;
                }
            }
        }

        return credential is null
            ? null
            : new ParsedCookies(
                credential,
                applicationCookies.Count == 0
                    ? null
                    : string.Join("; ", applicationCookies));
    }
}

internal sealed record ParsedCookies(
    SessionCredential Credential,
    string? ApplicationCookie) : IDisposable
{
    public void Dispose() => Credential.Dispose();
}
