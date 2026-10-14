using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed record MatrixConfiguration(string Origin, string ServerName, string JwtSecret, string RegistrationSecret, string ServiceMatrixId);

public sealed partial class AccountAuthority : IDisposable
{
    private readonly HttpClient client;
    private readonly CancellationTokenSource lifetime = new();
    private readonly ConcurrentDictionary<string, string> sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (SemaphoreSlim Gate, int References)> operations = new(StringComparer.Ordinal);
    private readonly object operationLock = new();
    private readonly CancellationToken stopped;
    private readonly MatrixConfiguration configuration;
    private readonly TimeProvider time;
    private int disposed;

    public AccountAuthority(MatrixConfiguration configuration, TimeProvider? time = null)
    {
        var origin = Validation.Origin(configuration.Origin);
        if (!origin.IsSuccess || !Validation.UserId(configuration.ServiceMatrixId)
            || !configuration.ServiceMatrixId.EndsWith(":" + configuration.ServerName, StringComparison.Ordinal)
            || configuration.JwtSecret.Length == 0 || configuration.RegistrationSecret.Length == 0)
            throw new ArgumentException("Invalid native Matrix authority configuration");
        this.configuration = configuration with { Origin = origin.Value };
        this.time = time ?? TimeProvider.System;
        stopped = lifetime.Token;
        client = NativeHttp.Client();
    }

    private NativeEndpoint Server(string? token = null) => new(configuration.Origin, token);
    private bool Local(string id) => Validation.UserId(id) && id.EndsWith(":" + configuration.ServerName, StringComparison.Ordinal);

    public async ValueTask<Result<string>> Identify(string token, CancellationToken cancellation = default)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped);
        var opened = await NativeHttp.Json(client, Server(token), "GET", MatrixJson.Api + "/account/whoami", cancellation: linked.Token);
        if (!opened.IsSuccess) return Result<string>.Fail(opened.Error);
        using var response = opened.Value;
        var id = MatrixJson.Text(response.Body, "user_id");
        return response.Status == 200 && id is not null && Local(id) ? Result<string>.Success(id)
            : Results.Fail<string>("unauthorized", "Invalid native identity");
    }

    public ValueTask<Result<NativeEndpoint>> AsUser(string id, CancellationToken cancellation = default)
        => Exclusive(id, linked => OpenAsUser(id, linked), cancellation);

    private async ValueTask<Result<NativeEndpoint>> OpenAsUser(string id, CancellationToken cancellation)
    {
        if (!Local(id)) return Results.Fail<NativeEndpoint>("invalid", "Invalid local control identity");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped);
        if (sessions.TryGetValue(id, out var cached))
        {
            var checkedSession = await NativeHttp.Json(client, Server(cached), "GET", MatrixJson.Api + "/account/whoami", cancellation: linked.Token);
            if (!checkedSession.IsSuccess) return Result<NativeEndpoint>.Fail(checkedSession.Error);
            using var response = checkedSession.Value;
            if (response.Status == 200 && MatrixJson.Text(response.Body, "user_id") == id) return Result<NativeEndpoint>.Success(Server(cached));
            if (response.Status != 401) return Results.Fail<NativeEndpoint>("native", "Native control identity could not be verified");
            sessions.TryRemove(id, out _);
        }
        var header = Encode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
        var payload = MatrixJson.Object(writer => { writer.WriteString("sub", id); writer.WriteNumber("exp", time.GetUtcNow().ToUnixTimeSeconds() + 60); });
        var unsigned = header + "." + Encode(payload.GetRawText());
        var jwt = unsigned + "." + Base64(HMACSHA256.HashData(Encoding.UTF8.GetBytes(configuration.JwtSecret), Encoding.UTF8.GetBytes(unsigned)));
        var body = MatrixJson.Object(writer =>
        {
            writer.WriteString("type", "m.login.token"); writer.WriteString("token", jwt); writer.WriteString("device_id", "CROSSFIRE_MANAGEMENT");
            writer.WriteString("initial_device_display_name", "Crossfire management");
        });
        var result = await MatrixJson.Ok(client, Server(), "POST", MatrixJson.Api + "/login", body, linked.Token);
        if (!result.IsSuccess) return Result<NativeEndpoint>.Fail(result.Error);
        var account = Credentials(result.Value, id);
        if (!account.IsSuccess) return Result<NativeEndpoint>.Fail(account.Error);
        sessions[id] = account.Value.AccessToken;
        return Result<NativeEndpoint>.Success(Server(account.Value.AccessToken));
    }

    public async ValueTask<Result<string?>> ProfileName(string id, CancellationToken cancellation = default)
    {
        if (!Validation.UserId(id)) return Results.Fail<string?>("invalid", "Invalid native profile identity");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped);
        var result = await MatrixJson.Ok(client, Server(), "GET", MatrixJson.Api + "/profile/" + MatrixJson.Segment(id) + "/displayname", cancellation: linked.Token);
        if (!result.IsSuccess) return Result<string?>.Fail(result.Error);
        if (!result.Value.TryGetProperty("displayname", out var name) || name.ValueKind == JsonValueKind.Null) return Result<string?>.Success(null);
        var parsed = Validation.Text(name);
        return parsed.IsSuccess ? Result<string?>.Success(parsed.Value) : Results.Fail<string?>("native", "Invalid native profile display name");
    }

    public async ValueTask<Result<bool>> Exists(string id, CancellationToken cancellation = default)
    {
        if (!Local(id)) return Results.Fail<bool>("invalid", "Invalid local native identity");
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped);
        var result = await NativeHttp.Json(client, Server(), "GET", MatrixJson.Api + "/register/available?username=" + MatrixJson.Segment(id[1..id.IndexOf(':')]), cancellation: linked.Token);
        if (!result.IsSuccess) return Result<bool>.Fail(result.Error);
        using var response = result.Value;
        if (response.Status == 200 && response.Body.ValueKind == JsonValueKind.Object && response.Body.TryGetProperty("available", out var available) && available.ValueKind == JsonValueKind.True)
            return Result<bool>.Success(false);
        return response.Status == 400 && MatrixJson.Error(response.Body, "M_USER_IN_USE") ? Result<bool>.Success(true)
            : Results.Fail<bool>("native", "Native account existence could not be verified");
    }

    public ValueTask<Result<MatrixAccount>> Provision(string id, string password, string device = "CROSSFIRE_AGENT", CancellationToken cancellation = default)
        => Exclusive(id, linked => Register(id, password, device, linked), cancellation);

    private async ValueTask<Result<MatrixAccount>> Register(string id, string password, string device, CancellationToken cancellation)
    {
        if (!Local(id) || !CleanText(password, 1024) || !CleanText(device, 100))
            return Results.Fail<MatrixAccount>("invalid", "Invalid native account provisioning input");
        JsonElement Body(string? stage = null, string? session = null) => MatrixJson.Object(writer =>
        {
            writer.WriteString("username", id[1..id.IndexOf(':')]); writer.WriteString("password", password);
            writer.WriteString("device_id", device); writer.WriteBoolean("inhibit_login", false);
            if (stage is not null)
            {
                writer.WriteStartObject("auth"); writer.WriteString("type", stage); writer.WriteString("session", session);
                if (stage == "m.login.registration_token") writer.WriteString("token", configuration.RegistrationSecret);
                writer.WriteEndObject();
            }
        });
        var result = await NativeHttp.Json(client, Server(), "POST", MatrixJson.Api + "/register", Body(), cancellation: cancellation);
        for (var attempt = 0; result.IsSuccess && result.Value.Status == 401 && attempt < 4; attempt++)
        {
            using var challenge = result.Value;
            var session = MatrixJson.Text(challenge.Body, "session");
            if (session is null || !challenge.Body.TryGetProperty("flows", out var flows) || flows.ValueKind != JsonValueKind.Array)
                return Results.Fail<MatrixAccount>("native", "Invalid native registration challenge");
            var completed = challenge.Body.TryGetProperty("completed", out var done) && done.ValueKind == JsonValueKind.Array
                ? done.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetString()).ToArray() : [];
            var stage = flows.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.Object && value.TryGetProperty("stages", out var values) && values.ValueKind == JsonValueKind.Array)
                .SelectMany(value => value.GetProperty("stages").EnumerateArray()).FirstOrDefault(value => value.ValueKind == JsonValueKind.String && !completed.Contains(value.GetString()));
            var selected = stage.ValueKind == JsonValueKind.String ? stage.GetString() : null;
            if (selected is not ("m.login.registration_token" or "m.login.dummy")) return Results.Fail<MatrixAccount>("native", "Unsupported native registration challenge");
            result = await NativeHttp.Json(client, Server(), "POST", MatrixJson.Api + "/register", Body(selected, session), cancellation: cancellation);
        }
        if (!result.IsSuccess) return Result<MatrixAccount>.Fail(result.Error);
        using var response = result.Value;
        if (response.Status == 400 && MatrixJson.Error(response.Body, "M_USER_IN_USE"))
        {
            var login = await NativeHttp.Json(client, Server(), "POST", MatrixJson.Api + "/login", Password(id, password, device), cancellation: cancellation);
            if (!login.IsSuccess) return Result<MatrixAccount>.Fail(login.Error);
            using var account = login.Value;
            return account.Status == 200 ? Credentials(account.Body, id) : Results.Fail<MatrixAccount>("native", "Account provisioning is not complete");
        }
        return response.Status == 200 ? Credentials(response.Body, id) : Results.Fail<MatrixAccount>("native", "Account provisioning is not complete");
    }

    private async ValueTask<Result<T>> Exclusive<T>(string id, Func<CancellationToken, ValueTask<Result<T>>> operation, CancellationToken cancellation)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped);
        SemaphoreSlim gate;
        lock (operationLock)
        {
            if (operations.TryGetValue(id, out var current)) { gate = current.Gate; operations[id] = (gate, current.References + 1); }
            else { gate = new SemaphoreSlim(1, 1); operations[id] = (gate, 1); }
        }
        var entered = false;
        try
        {
            await gate.WaitAsync(linked.Token); entered = true;
            return await operation(linked.Token);
        }
        catch (OperationCanceledException) { return Results.Fail<T>("native", "Native authority stopped"); }
        finally
        {
            if (entered) gate.Release();
            lock (operationLock)
            {
                var current = operations[id];
                if (current.References == 1) { operations.Remove(id); gate.Dispose(); }
                else operations[id] = (gate, current.References - 1);
            }
        }
    }

    public static JsonElement Password(string id, string password, string device)
        => MatrixJson.Object(writer =>
        {
            writer.WriteString("type", "m.login.password"); writer.WriteStartObject("identifier");
            writer.WriteString("type", "m.id.user"); writer.WriteString("user", id); writer.WriteEndObject();
            writer.WriteString("password", password); writer.WriteString("device_id", device);
        });

    private static Result<MatrixAccount> Credentials(JsonElement body, string expected)
    {
        var id = MatrixJson.Text(body, "user_id");
        var token = MatrixJson.Text(body, "access_token", 8192);
        var device = MatrixJson.Text(body, "device_id");
        return id == expected && id is not null && Validation.UserId(id) && token is not null && device is not null
            ? Result<MatrixAccount>.Success(new(id, token, device)) : Results.Fail<MatrixAccount>("native", "Unexpected native account credentials");
    }

    private static bool CleanText(string value, int maximum) => value.Length >= 1 && value.Length <= maximum && !value.Any(character => character is <= '\u001f' or '\u007f');
    private static string Base64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Encode(string value) => Base64(Encoding.UTF8.GetBytes(value));

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lifetime.Cancel(); sessions.Clear(); invitations.Clear(); client.Dispose(); lifetime.Dispose();
    }
}
