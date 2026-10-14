using System.Text;
using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.AspNetCore.WebUtilities;

namespace Crossfire.Server.Http;

public sealed record RegistrationConfirmation(InvitationClaim? Invitation, string Nonce);
public sealed record RegistrationSession(long ExpiresAt, bool Authorized = false, InvitationClaim? Invitation = null,
    MemberSignup? Details = null, RegistrationConfirmation? Confirmation = null);

public sealed class RegistrationTransport(ApiState state)
{
    public const string Stage = "org.crossfire.login.registration";
    public const string RegisterPath = "/_matrix/client/v3/register";
    public const string FallbackPath = "/_matrix/client/v3/auth/" + Stage + "/fallback/web";
    private readonly Dictionary<string, RegistrationSession> sessions = new(StringComparer.Ordinal);
    private readonly HashSet<string> pending = new(StringComparer.Ordinal);
    private readonly object gate = new();

    public bool Handles(string path) => path is RegisterPath or FallbackPath;

    public Task Handle(HttpContext http, string path, string requestId)
        => path == RegisterPath ? Register(http, requestId) : Fallback(http);

    private void Expire()
    {
        var now = state.Now();
        foreach (var key in sessions.Where(entry => entry.Value.ExpiresAt <= now).Select(entry => entry.Key).ToArray()) sessions.Remove(key);
    }

    private Result<(string Id, RegistrationSession Session)> Prepare(JsonElement body)
    {
        var auth = Property(body, "auth"); var sessionId = String(auth, "session");
        lock (gate)
        {
            Expire();
            RegistrationSession? session = null;
            if (auth.ValueKind == JsonValueKind.Object && auth.TryGetProperty("session", out _) && (sessionId is null || !sessions.TryGetValue(sessionId, out session)))
                return Results.Fail<(string, RegistrationSession)>("invalid", "Signup session is invalid or expired; restart registration");
            if (session is null)
            {
                if (sessions.Count >= 1000) return Results.Fail<(string, RegistrationSession)>("rate_limit", "Too many signup attempts");
                sessionId = Identity.Identifier(); session = new(state.Now() + 600000); sessions.Add(sessionId, session);
            }
            if (Has(body, "username") || Has(body, "password") || Has(body, "device_id"))
            {
                var username = String(body, "username"); var password = String(body, "password");
                var device = Has(body, "device_id") ? String(body, "device_id") : session.Details?.DeviceId ?? Identity.Identifier();
                var details = username is null || password is null || device is null ? null : new MemberSignup(username, password, device);
                if (details is null || !MemberRegistration.ValidSignup(details)) return Results.Fail<(string, RegistrationSession)>("invalid", "Choose a valid username and a password of at least 12 characters");
                if (session.Details is not null && session.Details != details) return Results.Fail<(string, RegistrationSession)>("invalid", "Account details changed; restart registration");
                session = session with { Details = details }; sessions[sessionId!] = session;
            }
            if (Has(auth, "type") && String(auth, "type") != Stage) return Results.Fail<(string, RegistrationSession)>("unsupported", "Unsupported authentication stage");
            return Result<(string, RegistrationSession)>.Success((sessionId!, session));
        }
    }

    private async Task Register(HttpContext http, string requestId)
    {
        if (http.Request.Method != "POST") { http.Response.Headers.Allow = "POST"; await NativeResponses.Error(http, requestId, 405, "M_UNRECOGNIZED", "Use POST"); return; }
        var body = await Transport.Read(http.Request, 2097152, http.RequestAborted);
        if (!body.IsSuccess) { await NativeResponses.Error(http, requestId, 400, "M_BAD_JSON", body.Error.Message); return; }
        using var database = new CrossfireDbContext(state.Database);
        var policy = PolicyQueries.Find(database);
        if (!policy.IsSuccess || policy.Value is null) { await NativeResponses.Error(http, requestId, 503, "M_UNKNOWN", "Signup policy unavailable"); return; }
        if (String(body.Value, "kind") == "guest" || http.Request.QueryString.Value?.Contains("kind=guest", StringComparison.Ordinal) == true)
        { await NativeResponses.Error(http, requestId, 403, "M_FORBIDDEN", "Guest registration is disabled"); return; }
        var prepared = Prepare(body.Value);
        if (!prepared.IsSuccess)
        {
            if (prepared.Error.Code == "rate_limit")
                await NativeResponses.Send(http, requestId, 429, JsonValues.Object(writer => { writer.WriteString("errcode", "M_LIMIT_EXCEEDED"); writer.WriteString("error", prepared.Error.Message); writer.WriteNumber("retry_after_ms", 60000); }));
            else await NativeResponses.Error(http, requestId, 400, prepared.Error.Code == "unsupported" ? "M_UNRECOGNIZED" : "M_INVALID_PARAM", prepared.Error.Message);
            return;
        }
        var (id, session) = prepared.Value;
        if (!session.Authorized)
        {
            await NativeResponses.Send(http, requestId, 401, JsonValues.Object(writer =>
            {
                writer.WriteString("session", id); writer.WriteStartArray("flows"); writer.WriteStartObject(); JsonValues.Strings(writer, "stages", [Stage]); writer.WriteEndObject(); writer.WriteEndArray();
                writer.WriteStartObject("params"); writer.WriteEndObject(); writer.WriteStartArray("completed"); writer.WriteEndArray();
            })); return;
        }
        if (session.Details is null) { await NativeResponses.Error(http, requestId, 400, "M_MISSING_PARAM", "Username and password are required"); return; }
        bool admitted; lock (gate) admitted = pending.Add(session.Details.Username);
        if (!admitted) { await NativeResponses.Error(http, requestId, 409, "M_USER_IN_USE", "This username is being registered"); return; }
        try
        {
            var ports = RegistrationQueries.Ports(database, state.Now, state.Matrix.Ports(), state.Matrix.RoomOperation, state.Configuration.ServerName, state.Configuration.ServiceMatrixId);
            var registered = await MemberRegistration.Register(ports, session.Details, session.Invitation is null ? null : new(session.Invitation.Id, session.Invitation.Secret), requestId, http.RequestAborted);
            if (!registered.IsSuccess)
            {
                var error = registered.Error; var status = error.Code is "forbidden" or "unauthorized" ? 403 : error.Code == "native" ? 502 : 400;
                await NativeResponses.Error(http, requestId, status, error.Code == "conflict" ? "M_USER_IN_USE" : status == 403 ? "M_FORBIDDEN" : "M_UNKNOWN", error.Message); return;
            }
            lock (gate) sessions.Remove(id);
            InvitationCookies.Set(http.Response, null);
            await NativeResponses.Send(http, requestId, 200, JsonValues.Object(writer =>
            {
                writer.WriteString("user_id", registered.Value.UserId); writer.WriteString("access_token", registered.Value.AccessToken);
                writer.WriteString("device_id", registered.Value.DeviceId); writer.WriteString("home_server", state.Configuration.ServerName);
            }));
        }
        finally { lock (gate) pending.Remove(session.Details.Username); }
    }

    private async Task Fallback(HttpContext http)
    {
        var query = Transport.Query(http.Request, ["session"]);
        var id = query.IsSuccess ? query.Value.GetValueOrDefault("session") : null;
        RegistrationSession? session;
        lock (gate) { Expire(); session = id is null ? null : sessions.GetValueOrDefault(id); }
        if (!query.IsSuccess || id is null || session?.Details is null)
        { await RegistrationPage.Error(http, 400, "This signup session is invalid or expired. Return to Element and restart signup."); return; }
        if (http.Request.Method is not ("GET" or "POST"))
        { http.Response.Headers.Allow = "GET, POST"; await RegistrationPage.Error(http, 405, "Use the invitation confirmation in Element."); return; }
        var invitation = InvitationCookies.Read(http.Request);
        using var database = new CrossfireDbContext(state.Database);
        var policy = PolicyQueries.Find(database);
        if (!policy.IsSuccess || policy.Value is null) { await RegistrationPage.Error(http, 503, "Signup policy is unavailable. Try again later."); return; }
        if (invitation is not null ? !Invitations.Verify(InvitationCommands.Ports(database, state.Now), invitation.Id, invitation.Secret).IsSuccess : policy.Value.SignupMode != "open")
        { await RegistrationPage.Error(http, 403, "Open your complete private invitation link in this browser, then return to Element to finish signup."); return; }
        if (http.Request.Method == "GET")
        {
            var nonce = Identity.Secret(); var updated = false;
            lock (gate)
            {
                if (sessions.TryGetValue(id, out var current) && current.ExpiresAt > state.Now())
                { sessions[id] = current with { Confirmation = new(invitation, nonce) }; updated = true; }
            }
            if (!updated) { await RegistrationPage.Error(http, 400, "Signup expired. Return to Element and restart signup."); return; }
            await RegistrationPage.Confirm(http, session.Details.Username, state.Configuration.ServerName, nonce, invitation is not null); return;
        }
        if (http.Request.Headers.Origin != state.Configuration.PublicOrigin)
        { await RegistrationPage.Error(http, 403, "Confirm the invitation from this server’s signup page."); return; }
        var bytes = http.Request.ContentType?.Split(';', 2)[0] == "application/x-www-form-urlencoded" ? await Transport.ReadBytes(http.Request, 1024, http.RequestAborted) : Results.Fail<byte[]>("invalid", "Expected form");
        var form = bytes.IsSuccess ? QueryHelpers.ParseQuery(Encoding.UTF8.GetString(bytes.Value)) : null;
        var authorized = false;
        lock (gate)
        {
            if (form is { Count: 1 } && form.TryGetValue("nonce", out var nonce) && nonce.Count == 1 && sessions.TryGetValue(id, out var current)
                && current.ExpiresAt > state.Now() && current.Confirmation is { } confirmation && confirmation.Nonce == nonce[0] && confirmation.Invitation == invitation)
            { sessions[id] = current with { Authorized = true, Invitation = invitation, Confirmation = null }; authorized = true; }
        }
        if (!authorized) { await RegistrationPage.Error(http, 403, "Account confirmation expired. Reopen it from Element."); return; }
        InvitationCookies.Set(http.Response, null); await RegistrationPage.Completed(http);
    }

    private static JsonElement Property(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) ? property : default;
    private static bool Has(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out _);
    private static string? String(JsonElement value, string name)
    {
        var property = Property(value, name);
        if (property.ValueKind != JsonValueKind.String) return null;
        var decoded = ProtocolJson.Unquote(property.GetRawText()); return decoded.IsSuccess ? decoded.Value : null;
    }
}
