using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.AdapterMatrix;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class HttpAcceptance
{
    public static async Task Verify()
    {
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var server = builder.Build();
        var registrationCalls = 0; var requests = 0;
        server.Run(async context =>
        {
            Interlocked.Increment(ref requests); context.Response.ContentType = "application/json";
            var path = context.Request.Path.Value;
            if (path is "/api/releases/current" or "/api/agents/11111111-1111-4111-8111-111111111111" or "/api/agents/11111111-1111-4111-8111-111111111111/owner-conversation")
            {
                Equal(context.Request.Headers.Authorization.ToString(), path == "/api/releases/current" ? "" : "Bearer exact-agent-token", "operation authentication follows its declared public or agent boundary");
                if (context.Request.Method == "POST") { using var input = await JsonDocument.ParseAsync(context.Request.Body); Equal(input.RootElement.GetRawText(), "{}", "bodyless operation arguments still serialize the canonical empty JSON object"); }
                else Equal(context.Request.ContentLength ?? 0, 0L, "GET operations do not transmit JSON bodies");
                await context.Response.WriteAsync("{\"data\":{},\"meta\":{\"requestId\":\"11111111-1111-4111-8111-111111111111\"}}"); return;
            }
            if (path == "/redirect") { context.Response.StatusCode = 302; context.Response.Headers.Location = "/unexpected"; await context.Response.WriteAsync("{}"); return; }
            if (path == "/too-large") { await context.Response.WriteAsync("{\"body\":\"" + new string('a', 2048) + "\"}"); return; }
            if (path == "/invalid-json") { await context.Response.WriteAsync("not json"); return; }
            if (path == "/_matrix/client/v3/account/whoami")
            {
                if (context.Request.Headers.Authorization == "Bearer native-owner-token") await context.Response.WriteAsync("{\"user_id\":\"@owner:example.test\"}");
                else { context.Response.StatusCode = 401; await context.Response.WriteAsync("{\"errcode\":\"M_UNKNOWN_TOKEN\"}"); }
                return;
            }
            if (path == "/_matrix/client/v3/register/available") { await context.Response.WriteAsync("{\"available\":true}"); return; }
            if (path == "/_matrix/client/v3/profile/@owner:example.test/displayname") { await context.Response.WriteAsync("{\"displayname\":\"Owner\"}"); return; }
            if (path == "/_matrix/client/v3/register")
            {
                using var request = await JsonDocument.ParseAsync(context.Request.Body); Interlocked.Increment(ref registrationCalls);
                Equal(request.RootElement.GetProperty("username").GetString(), "owner", "native registration username");
                if (!request.RootElement.TryGetProperty("auth", out var auth))
                { context.Response.StatusCode = 401; await context.Response.WriteAsync("{\"session\":\"native-session\",\"flows\":[{\"stages\":[\"m.login.registration_token\"]}]}"); }
                else
                { Equal(auth.GetProperty("token").GetString(), "registration-secret", "native registration secret"); await context.Response.WriteAsync("{\"user_id\":\"@owner:example.test\",\"access_token\":\"native-owner-token\",\"device_id\":\"CROSSFIRE_AGENT\"}"); }
                return;
            }
            if (path == "/_matrix/client/v3/login")
            {
                using var request = await JsonDocument.ParseAsync(context.Request.Body); var parts = request.RootElement.GetProperty("token").GetString()!.Split('.');
                Equal(parts.Length, 3, "native login JWT segments"); var unsigned = parts[0] + "." + parts[1];
                var expected = Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes("jwt-secret"), Encoding.UTF8.GetBytes(unsigned))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
                Equal(parts[2], expected, "exact native HS256 token");
                await context.Response.WriteAsync("{\"user_id\":\"@owner:example.test\",\"access_token\":\"native-owner-token\",\"device_id\":\"CROSSFIRE_MANAGEMENT\"}"); return;
            }
            context.Response.StatusCode = 404; await context.Response.WriteAsync("{\"errcode\":\"M_NOT_FOUND\"}");
        });
        await server.StartAsync();
        try
        {
            var origin = server.Urls.Single(); using var client = NativeHttp.Client(); var before = requests;
            var operations = new OperationClient(client, origin, () => "exact-agent-token", RestOperations.All);
            Equal((await operations.Call(new("release", new Dictionary<string, string>()), CancellationToken.None)).IsSuccess, true, "public operation omits an available bearer credential");
            Equal((await operations.Call(new("agent", new Dictionary<string, string> { ["agentId"] = "11111111-1111-4111-8111-111111111111" }), CancellationToken.None)).IsSuccess, true, "authenticated operation retains its exact credential");
            Equal((await operations.Call(new("ownerConversation", new Dictionary<string, string> { ["agentId"] = "11111111-1111-4111-8111-111111111111" }), CancellationToken.None)).IsSuccess, true, "empty operation input remains valid at the real HTTP boundary");
            before = requests;
            Equal((await NativeHttp.Json(client, new(origin), "GET", "//bad-origin/path")).Error.Code, "invalid", "origin escape rejected");
            Equal(requests, before, "no request on rejected origin");
            Equal((await NativeHttp.Json(client, new(origin), "GET", "/redirect")).Error.Code, "native", "redirect rejection");
            Equal((await NativeHttp.Json(client, new(origin), "GET", "/too-large", maximumBytes: 1024)).Error.Code, "body_too_large", "bounded network collection");
            Equal((await NativeHttp.Json(client, new(origin), "GET", "/invalid-json")).Error.Code, "native", "invalid native JSON rejection");
            using var authority = new AccountAuthority(new(origin, "example.test", "jwt-secret", "registration-secret", "@crossfire:example.test"));
            Equal((await authority.Identify("native-owner-token")).Value, "@owner:example.test", "native identity over real HTTP");
            Equal((await authority.Identify("wrong-token")).Error.Code, "unauthorized", "bad token rejection");
            Equal((await authority.ProfileName("@owner:example.test")).Value, "Owner", "native profile");
            Equal((await authority.Exists("@owner:example.test")).Value, false, "native availability");
            Equal((await authority.Provision("@owner:example.test", "long-enough-password")).IsSuccess, true, "native registration challenge");
            Equal(registrationCalls, 2, "exact registration challenge and response");
            Equal((await authority.AsUser("@owner:example.test")).Value.Token, "native-owner-token", "JWT authority login");
            Equal((await authority.AsUser("@owner:example.test")).Value.Token, "native-owner-token", "cached authority reverified");
            Equal((await authority.Deactivate("@crossfire:example.test")).Error.Code, "forbidden", "protected service account");
            authority.Dispose(); Equal((await authority.Identify("native-owner-token")).IsSuccess, false, "closed authority rejects new operations");
            Equal(Validation.UserId("@name\ufeff:example.test"), false, "ECMAScript whitespace rejection");
            Equal(Validation.UserId("@name\u0085:example.test"), true, "no additional whitespace restriction");
            Equal(MatrixJson.Segment("!room:'()*"), "!room%3A'()*", "canonical Matrix path encoding");
            using var apiError = JsonDocument.Parse(JsonSerializer.Serialize(new ApiFailure(new("invalid", "Invalid request"), new(Identity.Identifier())), ApiJson.Default.ApiFailure));
            Equal(apiError.RootElement.GetProperty("error").TryGetProperty("fieldErrors", out _), false, "optional API error field omission");
        }
        finally { await server.StopAsync(); }
    }
}
