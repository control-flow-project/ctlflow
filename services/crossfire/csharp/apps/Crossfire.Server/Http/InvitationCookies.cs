using Crossfire.Contracts;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class InvitationCookies
{
    public const string Name = "__Host-crossfire-invitation";

    public static MemberSignupClaim? Read(HttpRequest request)
    {
        var values = request.Headers.Cookie.ToString().Split(';').Select(value => value.Trim()).Where(value => value.StartsWith(Name + "=", StringComparison.Ordinal)).ToArray();
        if (values.Length != 1) return null;
        var parts = values[0][(Name.Length + 1)..].Split('.');
        return parts.Length == 2 && Validation.Identifier(parts[0]) && Validation.Secret(parts[1]) ? new(parts[0], parts[1]) : null;
    }

    public static void Set(HttpResponse response, string? value)
        => response.Headers.Append("Set-Cookie", Name + "=" + (value ?? "") + "; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=" + (value is null ? "0" : "600"));
}
