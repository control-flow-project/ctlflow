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
    private sealed class UntrustedProxy(Uri origin) : System.Net.IWebProxy
    {
        public System.Net.ICredentials? Credentials { get; set; }
        public Uri GetProxy(Uri destination) => origin;
        public bool IsBypassed(Uri host) => false;
    }
    public static async Task Verify()
    {
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var server = builder.Build();
        var registrationCalls = 0; var requests = 0; var invalidPages = false; var largeReply = false;
        server.Run(async context =>
        {
            Interlocked.Increment(ref requests); context.Response.ContentType = "application/json";
            var path = context.Request.Path.Value;
            if (path == "/proxy/native")
            {
                Equal(context.Request.Headers.Host.ToString(), "chat.example.test", "native forwarding retains the public host");
                Equal(context.Request.Headers.Authorization.ToString(), "Bearer native-token", "native forwarding retains only its native credential");
                foreach (var name in new[] { "Cookie", "Set-Cookie", "X-Private", "Forwarded", "X-Forwarded-Proto" }) Equal(context.Request.Headers.ContainsKey(name), false, "native forwarding excludes " + name);
                context.Response.Headers.SetCookie = "backend-secret=value"; context.Response.Headers.Connection = "X-Private";
                context.Response.Headers["X-Private"] = "hidden"; context.Response.Headers["X-Result"] = "visible";
                await context.Response.WriteAsync("native-response"); return;
            }
            if (path == "/unchanged") { context.Response.StatusCode = 304; return; }
            if (path == "/api/agents")
            {
                await context.Response.WriteAsync("{\"data\":[],\"meta\":{\"requestId\":\"11111111-1111-4111-8111-111111111111\",\"page\":1,\"pageSize\":20,\"totalItems\":0,\"totalPages\":" + (invalidPages ? "0" : "1") + "}}"); return;
            }
            if (path == "/api/publications/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222")
            {
                Equal(context.Request.ContentType, "application/octet-stream", "declared binary upload uses its native content type");
                using var bytes = new MemoryStream(); await context.Request.Body.CopyToAsync(bytes);
                Equal(bytes.ToArray().SequenceEqual(new byte[] { 0, 128, 255 }), true, "binary transport preserves non-UTF-8 bytes");
                Equal(context.Request.Headers.Authorization.ToString(), "Bearer exact-agent-token", "binary operation retains exact credentials");
                await context.Response.WriteAsync("{\"data\":{\"uploaded\":true},\"meta\":{\"requestId\":\"11111111-1111-4111-8111-111111111111\"}}"); return;
            }
            if (path is "/api/releases/current" or "/api/agents/11111111-1111-4111-8111-111111111111" or "/api/agents/11111111-1111-4111-8111-111111111111/owner-conversation")
            {
                Equal(context.Request.Headers.Authorization.ToString(), path == "/api/releases/current" ? "" : "Bearer exact-agent-token", "operation authentication follows its declared public or agent boundary");
                if (context.Request.Method == "POST") { using var input = await JsonDocument.ParseAsync(context.Request.Body); Equal(input.RootElement.GetRawText(), "{}", "bodyless operation arguments still serialize the canonical empty JSON object"); }
                else Equal(context.Request.ContentLength ?? 0, 0L, "GET operations do not transmit JSON bodies");
                var data = largeReply ? "{\"text\":\"" + new string('x', 16777216) + "\"}" : "{}";
                await context.Response.WriteAsync("{\"data\":" + data + ",\"meta\":{\"requestId\":\"11111111-1111-4111-8111-111111111111\"}}"); return;
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
        var proxyBuilder = WebApplication.CreateSlimBuilder(); proxyBuilder.Logging.ClearProviders(); proxyBuilder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var proxy = proxyBuilder.Build(); var forwarded = 0;
        proxy.Run(context => { Interlocked.Increment(ref forwarded); context.Response.StatusCode = 502; return Task.CompletedTask; });
        await proxy.StartAsync(); await server.StartAsync(); var previousProxy = HttpClient.DefaultProxy;
        try
        {
            HttpClient.DefaultProxy = new UntrustedProxy(new Uri(proxy.Urls.Single()));
            var origin = server.Urls.Single();
            using (var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(5) })
            { using var refusal = await probe.GetAsync(origin + "/proxy-probe"); Equal((int)refusal.StatusCode, 502, "hostile proxy fixture actually intercepts a default client"); }
            Equal(forwarded, 1, "the owned rejecting proxy receives only the credential-free control probe"); Interlocked.Exchange(ref forwarded, 0);
            using var client = NativeHttp.Client(); var before = requests;
            using (var nativeProxy = new MatrixProxy())
            {
                var forwardedContext = new DefaultHttpContext(); forwardedContext.Request.Method = "GET";
                forwardedContext.Request.Headers.Authorization = "Bearer native-token"; forwardedContext.Request.Headers.Cookie = "crossfire-session=private";
                forwardedContext.Request.Headers.SetCookie = "untrusted=value";
                forwardedContext.Request.Headers.Connection = "X-Private"; forwardedContext.Request.Headers["X-Private"] = "hidden";
                forwardedContext.Request.Headers["Forwarded"] = "for=spoofed"; forwardedContext.Request.Headers["X-Forwarded-Proto"] = "http";
                forwardedContext.Response.Body = new MemoryStream();
                await nativeProxy.Forward(forwardedContext, origin, "chat.example.test", "/proxy/native");
                Equal(forwardedContext.Response.StatusCode, 200, "native proxy forwards a successful response");
                Equal(Encoding.UTF8.GetString(((MemoryStream)forwardedContext.Response.Body).ToArray()), "native-response", "native proxy streams exact response bytes");
                Equal(forwardedContext.Response.Headers.ContainsKey("Set-Cookie") || forwardedContext.Response.Headers.ContainsKey("X-Private"), false, "native responses cannot write cookies or hop headers");
                Equal(forwardedContext.Response.Headers["X-Result"].ToString(), "visible", "end-to-end response headers remain available");
                var redirect = new DefaultHttpContext(); redirect.Request.Method = "GET";
                await nativeProxy.Forward(redirect, origin, "chat.example.test", "/redirect"); Equal(redirect.Response.StatusCode, 502, "native proxy rejects redirects rather than navigating to another origin");
                var unchanged = new DefaultHttpContext(); unchanged.Request.Method = "GET";
                await nativeProxy.Forward(unchanged, origin, "chat.example.test", "/unchanged"); Equal(unchanged.Response.StatusCode, 304, "cache validation is not a redirect");
                var secureOrigin = Environment.GetEnvironmentVariable("CROSSFIRE_TLS_TEST_ORIGIN") ?? throw new InvalidOperationException("Run core acceptance with its mandatory trusted TLS fixture");
                var secure = new DefaultHttpContext(); secure.Request.Method = "GET"; secure.Response.Body = new MemoryStream();
                await nativeProxy.Forward(secure, secureOrigin, "chat.example.test", "/native");
                Equal(secure.Response.StatusCode, 200, "HTTPS validates the configured backend certificate, not the public Host header");
                using var reply = JsonDocument.Parse(((MemoryStream)secure.Response.Body).ToArray());
                Equal(reply.RootElement.GetProperty("host").GetString(), "chat.example.test", "TLS target isolation preserves the public HTTP Host");
            }
            var operations = new OperationClient(client, origin, () => "exact-agent-token", RestOperations.All);
            Equal((await operations.Call(new("release", new Dictionary<string, string>()), CancellationToken.None)).IsSuccess, true, "public operation omits an available bearer credential");
            Equal((await operations.Call(new("agent", new Dictionary<string, string> { ["agentId"] = "11111111-1111-4111-8111-111111111111" }), CancellationToken.None)).IsSuccess, true, "authenticated operation retains its exact credential");
            Equal((await operations.Call(new("ownerConversation", new Dictionary<string, string> { ["agentId"] = "11111111-1111-4111-8111-111111111111" }), CancellationToken.None)).IsSuccess, true, "empty operation input remains valid at the real HTTP boundary");
            Equal((await operations.Call(new("agents", new Dictionary<string, string>()), CancellationToken.None)).IsSuccess, true, "collection with zero items has one logical page");
            invalidPages = true;
            Equal((await operations.Call(new("agents", new Dictionary<string, string>()), CancellationToken.None)).Error.Code, "invalid", "client rejects superseded zero-page metadata");
            var upload = new Dictionary<string, string> { ["publicationId"] = "11111111-1111-4111-8111-111111111111", ["fileId"] = "22222222-2222-4222-8222-222222222222" };
            Equal((await operations.Upload("uploadPublicationFile", upload, new byte[] { 0, 128, 255 }, CancellationToken.None)).IsSuccess, true, "native binary operation has the same declared request path");
            largeReply = true;
            Equal((await operations.Call(new("release", new Dictionary<string, string>()), CancellationToken.None)).IsSuccess, true, "public operation client retains the canonical 32 MiB response allowance");
            var privateClient = new OperationClient(client, origin, () => null, RestOperations.All, 30000, 16777216);
            Equal((await privateClient.Call(new("release", new Dictionary<string, string>()), CancellationToken.None)).Error.Code, "body_too_large", "explicit private transport keeps its 16 MiB bound");
            largeReply = false;
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
            Equal(MatrixSyntax.UserId("@name\ufeff:example.test"), false, "Matrix whitespace rejection belongs to the adapter");
            Equal(MatrixSyntax.UserId("@name\u0085:example.test"), true, "native syntax does not add non-ECMAScript whitespace restrictions");
            Equal(MatrixJson.Segment("!room:'()*"), "!room%3A'()*", "canonical Matrix path encoding");
            using var apiError = JsonDocument.Parse(JsonSerializer.Serialize(new ApiFailure(new("invalid", "Invalid request"), new(Identity.Identifier())), ApiJson.Default.ApiFailure));
            Equal(apiError.RootElement.GetProperty("error").TryGetProperty("fieldErrors", out _), false, "optional API error field omission");
            Equal(forwarded, 0, "private native credentials and operations never traverse the ambient proxy");
        }
        finally { HttpClient.DefaultProxy = previousProxy; await server.StopAsync(); await proxy.StopAsync(); }
    }
}
