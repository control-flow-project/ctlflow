using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterMatrix;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Crossfire.Server.Http;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class NativeServerAcceptance
{
    public static async Task Verify(HttpClient client, string origin, string owner, string ownerToken, string serverName, string invitationCookie, AccountAuthority matrix)
    {
        async Task<string> Request(string method, string path, int status, JsonElement? body = null, string? form = null,
            string? bearer = null, string? cookie = null, string? requestOrigin = "http://127.0.0.1")
        {
            using var request = new HttpRequestMessage(new(method), origin + path); request.Headers.Host = "127.0.0.1";
            if (requestOrigin is not null) request.Headers.TryAddWithoutValidation("Origin", requestOrigin);
            if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            if (cookie is not null) request.Headers.TryAddWithoutValidation("Cookie", cookie);
            if (body is not null)
            { request.Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(body.Value, ApiJson.Default.JsonElement)); request.Content.Headers.ContentType = new("application/json"); }
            if (form is not null) request.Content = new StringContent(form, Encoding.UTF8, "application/x-www-form-urlencoded");
            using var response = await client.SendAsync(request); var text = await response.Content.ReadAsStringAsync();
            Equal((int)response.StatusCode, status, "native browser HTTP " + method + " " + path + (status == (int)response.StatusCode ? "" : ": " + text));
            Equal(response.Headers.CacheControl?.NoStore, true, "registration and directory responses never cache credentials");
            if (response.Content.Headers.ContentType?.MediaType == "text/html")
            {
                Equal(response.Headers.GetValues("Content-Security-Policy").Single().Contains("frame-ancestors 'none'", StringComparison.Ordinal), true, "native confirmation page rejects embedding");
                Equal(response.Headers.GetValues("X-Frame-Options").Single(), "DENY", "native confirmation page is not frameable");
            }
            return text;
        }
        var search = JsonValues.Object(writer => { writer.WriteString("search_term", ""); writer.WriteNumber("limit", 1); });
        using (var results = JsonDocument.Parse(await Request("POST", "/_matrix/client/v3/user_directory/search", 200, search, bearer: ownerToken, cookie: "__Host-crossfire=unrelated")))
            Equal(results.RootElement.GetProperty("results").GetArrayLength(), 1, "Matrix directory permits its native bearer independently of management cookies");
        using (var results = JsonDocument.Parse(await Request("POST", "/_matrix/client/v3/user_directory/search", 200, JsonValues.Object(writer => { writer.WriteString("search_term", ""); writer.WriteNumber("limit", 0); }), bearer: ownerToken)))
        { Equal(results.RootElement.GetProperty("results").GetArrayLength(), 0, "zero-limit Matrix search has no results"); Equal(results.RootElement.GetProperty("limited").GetBoolean(), true, "zero-limit search retains total information"); }
        await Request("POST", "/_matrix/client/v3/user_directory/search", 401, search);
        await Request("POST", "/_matrix/client/v3/user_directory/search?access_token=ignored", 400, search, bearer: ownerToken);
        await Request("GET", "/_matrix/client/v3/user_directory/search", 405);
        await Request("POST", "/_matrix/client/v3/user_directory/search", 400, JsonValues.Object(writer => { writer.WriteString("search_term", ""); writer.WriteString("unknown", "no"); }), bearer: ownerToken);
        var profile = JsonValues.Object(writer => writer.WriteString("displayname", "HTTP reviewed owner"));
        await Request("PUT", "/_matrix/client/v3/profile/" + Uri.EscapeDataString(owner) + "/displayname", 200, profile, bearer: ownerToken);
        Equal((await matrix.ProfileName(owner)).Value, "HTTP reviewed owner", "self profile mutation updates canonical member intent and actual Matrix profile");
        await Request("PUT", "/_matrix/client/v3/profile/" + Uri.EscapeDataString("@another:" + serverName) + "/displayname", 403, profile, bearer: ownerToken);
        var username = "signup-" + Identity.Identifier(); var password = Identity.Secret();
        var details = JsonValues.Object(writer => { writer.WriteString("username", username); writer.WriteString("password", password); writer.WriteString("device_id", "CROSSFIRE_HTTP_SIGNUP"); });
        string session;
        using (var challenge = JsonDocument.Parse(await Request("POST", RegistrationTransport.RegisterPath, 401, details)))
        {
            session = challenge.RootElement.GetProperty("session").GetString()!;
            Equal(challenge.RootElement.GetProperty("flows")[0].GetProperty("stages")[0].GetString(), RegistrationTransport.Stage, "registration advertises the canonical authentication stage");
        }
        var fallback = RegistrationTransport.FallbackPath + "?session=" + session;
        await Request("GET", fallback, 403, requestOrigin: null);
        var confirmation = await Request("GET", fallback, 200, cookie: invitationCookie, requestOrigin: null);
        Equal(confirmation.Contains(password, StringComparison.Ordinal), false, "signup confirmation never prints the submitted password");
        Equal(confirmation.Contains("@" + username + ":" + serverName, StringComparison.Ordinal), true, "signup confirmation names the exact account");
        var marker = "name=\"nonce\" value=\""; var start = confirmation.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
        var nonce = confirmation[start..confirmation.IndexOf('"', start)];
        await Request("POST", fallback, 403, form: "nonce=" + nonce, cookie: invitationCookie, requestOrigin: null);
        await Request("POST", fallback, 403, form: "nonce=invalid", cookie: invitationCookie);
        await Request("POST", fallback, 403, form: "nonce=" + nonce + "&nonce=" + nonce, cookie: invitationCookie);
        await Request("POST", fallback, 200, form: "nonce=" + nonce, cookie: invitationCookie);
        await Request("POST", fallback, 403, form: "nonce=" + nonce, cookie: invitationCookie);
        var complete = JsonValues.Object(writer => { writer.WriteStartObject("auth"); writer.WriteString("type", RegistrationTransport.Stage); writer.WriteString("session", session); writer.WriteEndObject(); });
        using (var registered = JsonDocument.Parse(await Request("POST", RegistrationTransport.RegisterPath, 200, complete)))
        {
            Equal(registered.RootElement.GetProperty("user_id").GetString(), "@" + username + ":" + serverName, "registration returns the exact verified native identity");
            Equal((await matrix.Identify(registered.RootElement.GetProperty("access_token").GetString()!)).Value, "@" + username + ":" + serverName, "new registration access token works with actual Matrix");
        }
        await Request("POST", RegistrationTransport.RegisterPath, 400, complete);
        await Request("GET", fallback, 400, cookie: invitationCookie, requestOrigin: null);
        await Request("POST", RegistrationTransport.RegisterPath + "?kind=guest", 403, details);
    }
}
